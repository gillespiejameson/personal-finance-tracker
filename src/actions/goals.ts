"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate, todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import {
  archiveGoal,
  createGoal,
  listGoals,
  updateGoal,
} from "@/lib/goals/store";
import type { Goal } from "@/lib/goals/types";
import { loadLines } from "@/lib/insights/lines";

type Fail = { ok: false; error: string };
const idSchema = z.number().int().positive();
const nameSchema = z.string().min(1).max(40);
const targetCentsSchema = z
  .number()
  .int()
  .min(1, "Target must be more than $0.")
  .max(100_000_000);
const startingCentsSchema = z.number().int().min(0).max(100_000_000);
const targetDateSchema = z
  .string()
  .refine(isIsoDate, "Invalid date.")
  .nullable();

function refresh() {
  for (const p of ["/budget", "/goals", "/home", "/settings"])
    revalidatePath(p);
}

export async function listGoalsAction(): Promise<Goal[]> {
  const db = getDb();
  return listGoals(db, loadLines(db), todayIso());
}

const createSchema = z.object({
  name: nameSchema,
  targetCents: targetCentsSchema,
  targetDate: targetDateSchema,
  startingCents: startingCentsSchema,
});
export async function createGoalAction(input: {
  name: string;
  targetCents: number;
  targetDate: string | null;
  startingCents: number;
}): Promise<{ ok: true; id: number } | Fail> {
  const p = createSchema.safeParse(input);
  if (!p.success)
    return { ok: false, error: p.error.issues[0]?.message ?? "Invalid goal." };
  const r = createGoal(getDb(), { ...p.data, today: todayIso() });
  if (r.ok) refresh();
  return r;
}

const updateSchema = z.object({
  id: idSchema,
  name: nameSchema.optional(),
  targetCents: targetCentsSchema.optional(),
  targetDate: targetDateSchema.optional(),
  startingCents: startingCentsSchema.optional(),
});
export async function updateGoalAction(input: {
  id: number;
  name?: string;
  targetCents?: number;
  targetDate?: string | null;
  startingCents?: number;
}): Promise<{ ok: true } | Fail> {
  const p = updateSchema.safeParse(input);
  if (!p.success)
    return { ok: false, error: p.error.issues[0]?.message ?? "Invalid goal." };
  const { id, ...patch } = p.data;
  const r = updateGoal(getDb(), id, patch);
  if (r.ok) refresh();
  return r;
}

export async function archiveGoalAction(
  input: number,
): Promise<{ ok: true } | Fail> {
  const p = idSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid id." };
  const r = archiveGoal(getDb(), p.data);
  if (r.ok) refresh();
  return r;
}
