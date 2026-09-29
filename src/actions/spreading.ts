"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listBudgetLeaves } from "@/lib/budget/store";
import { isIsoDate, todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { listBills } from "@/lib/recurring/refresh";
import { irregularItems } from "@/lib/spreading/items";
import {
  archivePlanned,
  createPlanned,
  listPlanned,
  listPlannedCategoryOptions as listPlannedCategoryOptionsFromDb,
  type PlannedCategoryOption,
  updatePlanned,
} from "@/lib/spreading/store";
import type { Every, IrregularItem } from "@/lib/spreading/types";

type Fail = { ok: false; error: string };

const idSchema = z.number().int().positive();
const nameSchema = z
  .string()
  .trim()
  .min(1, "Name it.")
  .max(60, "Keep the name under 60 characters.");
const amountCentsSchema = z
  .number()
  .int()
  .min(1, "Enter an amount.")
  .max(100_000_000, "That amount is too large.");
const everySchema = z.enum(["year", "quarter", "once"]);
const dueDateSchema = z.string().refine(isIsoDate, "Enter a valid date.");
const categoryIdSchema = z.number().int().positive().nullable();

function refresh() {
  for (const p of ["/bills", "/budget", "/budget/setup", "/home"])
    revalidatePath(p);
}

export async function listPlannedCategoryOptions(): Promise<
  PlannedCategoryOption[]
> {
  return listPlannedCategoryOptionsFromDb(getDb());
}

export async function listIrregular(): Promise<{
  today: string;
  items: IrregularItem[];
}> {
  const db = getDb();
  const today = todayIso();
  const { bills } = listBills(db, { today });
  const planned = listPlanned(db);
  const leaves = listBudgetLeaves(db);
  return { today, items: irregularItems({ bills, planned, today, leaves }) };
}

const createSchema = z.object({
  name: nameSchema,
  amountCents: amountCentsSchema,
  dueDate: dueDateSchema,
  every: everySchema,
  categoryId: categoryIdSchema,
});
export async function createPlannedExpense(input: {
  name: string;
  amountCents: number;
  dueDate: string;
  every: Every;
  categoryId: number | null;
}): Promise<{ ok: true; id: number } | Fail> {
  const p = createSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Invalid planned expense.",
    };
  const r = createPlanned(getDb(), p.data);
  if (r.ok) refresh();
  return r;
}

const updateSchema = z.object({
  id: idSchema,
  name: nameSchema.optional(),
  amountCents: amountCentsSchema.optional(),
  dueDate: dueDateSchema.optional(),
  every: everySchema.optional(),
  categoryId: categoryIdSchema.optional(),
});
export async function updatePlannedExpense(input: {
  id: number;
  name?: string;
  amountCents?: number;
  dueDate?: string;
  every?: Every;
  categoryId?: number | null;
}): Promise<{ ok: true } | Fail> {
  const p = updateSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Invalid planned expense.",
    };
  const { id, ...patch } = p.data;
  const r = updatePlanned(getDb(), id, patch);
  if (r.ok) refresh();
  return r;
}

export async function archivePlannedExpense(
  input: number,
): Promise<{ ok: true } | Fail> {
  const p = idSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid id." };
  const r = archivePlanned(getDb(), p.data);
  if (r.ok) refresh();
  return r;
}
