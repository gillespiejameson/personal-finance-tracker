"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PAYDAY_KEY, paydaySchema, resolvePayday } from "@/lib/budget/payday";
import type { PaydayConfig, ResolvedPayday } from "@/lib/budget/types";
import {
  addCategory,
  addParentCategory,
  archiveCategory,
  archiveParentCategory,
  categoryReferences,
  deleteCategory,
  deleteParentCategory,
  listCategoryTree,
  renameCategory,
  renameParentCategory,
  setCategoryFixed,
  setParentColor,
} from "@/lib/categories/manage";
import { todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { listBills } from "@/lib/recurring/refresh";
import { getSetting, setSetting } from "@/lib/settings";

// Next 16 rejects re-exporting an async function from another "use server"
// module ("Only async functions are allowed to be exported"), so
// `rerunDetectionAction` is imported directly from `@/actions/review` by
// whichever component needs it instead of being re-exported here.

const id = z.number().int().positive();
const name = z.string().min(1).max(40);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
function refresh() {
  for (const p of [
    "/settings",
    "/review",
    "/transactions",
    "/home",
    "/budget",
    "/goals",
    "/insights",
    "/bills",
  ])
    revalidatePath(p);
}

export async function getSettingsPage() {
  return { tree: listCategoryTree(getDb()) };
}
export async function renameCategoryAction(input: {
  id: number;
  name: string;
}) {
  const p = z.object({ id, name }).safeParse(input);
  if (!p.success)
    return { ok: false as const, error: "Name must be 1–40 characters." };
  const r = renameCategory(getDb(), p.data.id, p.data.name);
  if (r.ok) refresh();
  return r;
}
export async function addCategoryAction(input: {
  parentId: number;
  name: string;
  isFixed?: boolean;
}) {
  const p = z
    .object({ parentId: id, name, isFixed: z.boolean().optional() })
    .safeParse(input);
  if (!p.success)
    return { ok: false as const, error: "Name must be 1–40 characters." };
  const r = addCategory(getDb(), p.data.parentId, p.data.name, {
    isFixed: p.data.isFixed,
  });
  if (r.ok) refresh();
  return r;
}
export async function archiveCategoryAction(input: number) {
  const p = id.safeParse(input);
  if (!p.success) return { ok: false as const, error: "Invalid id." };
  const r = archiveCategory(getDb(), p.data);
  if (r.ok) refresh();
  return r;
}
export async function setCategoryFixedAction(input: {
  id: number;
  isFixed: boolean;
}) {
  const p = z.object({ id, isFixed: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false as const, error: "Invalid request." };
  const r = setCategoryFixed(getDb(), p.data.id, p.data.isFixed);
  if (r.ok) refresh();
  return r;
}
export async function addParentCategoryAction(input: {
  name: string;
  color?: string;
}) {
  const p = z.object({ name, color: color.optional() }).safeParse(input);
  if (!p.success)
    return { ok: false as const, error: "Name must be 1–40 characters." };
  const r = addParentCategory(getDb(), p.data.name, { color: p.data.color });
  if (r.ok) refresh();
  return r;
}
export async function renameParentCategoryAction(input: {
  id: number;
  name: string;
}) {
  const p = z.object({ id, name }).safeParse(input);
  if (!p.success)
    return { ok: false as const, error: "Name must be 1–40 characters." };
  const r = renameParentCategory(getDb(), p.data.id, p.data.name);
  if (r.ok) refresh();
  return r;
}
export async function setParentColorAction(input: {
  id: number;
  color: string;
}) {
  const p = z.object({ id, color }).safeParse(input);
  if (!p.success) return { ok: false as const, error: "Invalid request." };
  const r = setParentColor(getDb(), p.data.id, p.data.color);
  if (r.ok) refresh();
  return r;
}
export async function archiveParentCategoryAction(input: number) {
  const p = id.safeParse(input);
  if (!p.success) return { ok: false as const, error: "Invalid id." };
  const r = archiveParentCategory(getDb(), p.data);
  if (r.ok) refresh();
  return r;
}
export async function listCategoryReferencesAction(input: number) {
  const p = id.safeParse(input);
  if (!p.success) return null;
  return categoryReferences(getDb(), p.data);
}
export async function deleteCategoryAction(input: {
  id: number;
  moveTo?: number;
}) {
  const p = z.object({ id, moveTo: id.optional() }).safeParse(input);
  if (!p.success) return { ok: false as const, error: "Invalid request." };
  const r = deleteCategory(getDb(), p.data.id, { moveTo: p.data.moveTo });
  if (r.ok) refresh();
  return r;
}
export async function deleteParentCategoryAction(input: number) {
  const p = id.safeParse(input);
  if (!p.success) return { ok: false as const, error: "Invalid id." };
  const r = deleteParentCategory(getDb(), p.data);
  if (r.ok) refresh();
  return r;
}

export async function getPaydayAction(): Promise<{
  stored: PaydayConfig | null;
  resolved: ResolvedPayday;
}> {
  const db = getDb();
  const today = todayIso();
  const parsed = paydaySchema.safeParse(
    getSetting<unknown>(db, PAYDAY_KEY, null),
  );
  const stored = parsed.success ? (parsed.data as PaydayConfig) : null;
  const bills = listBills(db, { today }).bills;
  return { stored, resolved: resolvePayday(db, bills, today) };
}
export async function setPaydayAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = paydaySchema.safeParse(input);
  if (!p.success) return { ok: false as const, error: "Invalid schedule." };
  setSetting(getDb(), PAYDAY_KEY, p.data);
  refresh();
  return { ok: true };
}
export async function clearPaydayAction(): Promise<{ ok: true }> {
  getDb().delete(settings).where(eq(settings.key, PAYDAY_KEY)).run();
  refresh();
  return { ok: true };
}
