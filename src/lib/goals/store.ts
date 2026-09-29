import { eq } from "drizzle-orm";
import { findCategoryIdBySeedKey } from "@/lib/categories/ensure";
import {
  addCategory,
  archiveCategory,
  renameCategory,
} from "@/lib/categories/manage";
import type { Db } from "@/lib/db/client";
import { goals } from "@/lib/db/schema";
import type { Line } from "@/lib/insights/lines";
import { goalMath } from "./math";
import type { Goal } from "./types";

export function createGoal(
  db: Db,
  i: {
    name: string;
    targetCents: number;
    targetDate: string | null;
    startingCents: number;
    today: string;
  },
): { ok: true; id: number } | { ok: false; error: string } {
  const parentId = findCategoryIdBySeedKey(db, "savings");
  if (parentId === undefined)
    return { ok: false, error: "Savings & Investing category is missing." };
  return db.transaction((tx) => {
    const leaf = addCategory(tx as unknown as Db, parentId, i.name, {
      isFixed: true,
    });
    // Nothing has been written yet when addCategory refuses, so returning here
    // needs no explicit rollback: the transaction simply commits no changes.
    // A failure of the insert below, after the leaf row exists, throws instead
    // and is rolled back automatically by db.transaction.
    if (!leaf.ok) return leaf;
    const [row] = tx
      .insert(goals)
      .values({
        name: i.name.trim(),
        targetCents: i.targetCents,
        targetDate: i.targetDate,
        categoryId: leaf.id,
        startDate: i.today,
        startingCents: i.startingCents,
      })
      .returning({ id: goals.id })
      .all();
    return { ok: true, id: row.id };
  });
}

export function updateGoal(
  db: Db,
  id: number,
  patch: {
    name?: string;
    targetCents?: number;
    targetDate?: string | null;
    startingCents?: number;
  },
): { ok: true } | { ok: false; error: string } {
  const goal = db.select().from(goals).where(eq(goals.id, id)).get();
  if (!goal) return { ok: false, error: "Goal not found." };
  if (
    patch.name !== undefined &&
    patch.name.trim() !== goal.name &&
    goal.categoryId !== null
  ) {
    const renamed = renameCategory(db, goal.categoryId, patch.name);
    if (!renamed.ok) return renamed;
  }
  const set: Partial<typeof goals.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.targetCents !== undefined) set.targetCents = patch.targetCents;
  if (patch.targetDate !== undefined) set.targetDate = patch.targetDate;
  if (patch.startingCents !== undefined)
    set.startingCents = patch.startingCents;
  if (Object.keys(set).length > 0)
    db.update(goals).set(set).where(eq(goals.id, id)).run();
  return { ok: true };
}

export function archiveGoal(
  db: Db,
  id: number,
): { ok: true } | { ok: false; error: string } {
  const goal = db.select().from(goals).where(eq(goals.id, id)).get();
  if (!goal) return { ok: false, error: "Goal not found." };
  db.update(goals).set({ archived: true }).where(eq(goals.id, id)).run();
  if (goal.categoryId !== null) archiveCategory(db, goal.categoryId);
  return { ok: true };
}

export function listGoals(
  db: Db,
  lines: Line[],
  today: string,
  opts: { includeArchived?: boolean } = {},
): Goal[] {
  const rows = db
    .select()
    .from(goals)
    .where(opts.includeArchived ? undefined : eq(goals.archived, false))
    .all();
  const out: Goal[] = rows.map((g) => {
    const contributionsCents = lines
      .filter(
        (l) => l.categoryId === g.categoryId && l.date >= (g.startDate ?? ""),
      )
      .reduce((sum, l) => sum - l.amountCents, 0);
    const math = goalMath({
      targetCents: g.targetCents,
      startingCents: g.startingCents,
      contributionsCents,
      targetDate: g.targetDate,
      today,
    });
    return {
      id: g.id,
      name: g.name,
      targetCents: g.targetCents,
      targetDate: g.targetDate,
      categoryId: g.categoryId as number,
      startingCents: g.startingCents,
      startDate: g.startDate as string,
      archived: g.archived,
      progressCents: math.progressCents,
      pct: math.pct,
      monthsRemaining: math.monthsRemaining,
      monthlyNeededCents: math.monthlyNeededCents,
      reached: math.reached,
    };
  });
  return out.sort((a, b) => {
    if (a.targetDate === null && b.targetDate === null)
      return a.name.localeCompare(b.name);
    if (a.targetDate === null) return 1;
    if (b.targetDate === null) return -1;
    if (a.targetDate !== b.targetDate)
      return a.targetDate < b.targetDate ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function goalNeededByGoalId(goals: Goal[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const g of goals)
    if (g.monthlyNeededCents !== null) map.set(g.id, g.monthlyNeededCents);
  return map;
}
