import { and, eq, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "@/lib/db/client";
import { categories, plannedExpenses } from "@/lib/db/schema";
import type { Every, PlannedExpense } from "./types";

type Fail = { ok: false; error: string };

export type PlannedCategoryOption = {
  id: number;
  name: string;
  color: string;
  parentName: string | null;
};

/**
 * Leaf categories a planned expense can be filed under — expense categories
 * only, so income leaves (e.g. "Paycheck") never show up in the picker.
 */
export function listPlannedCategoryOptions(db: Db): PlannedCategoryOption[] {
  const parent = alias(categories, "parent");
  return db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      parentName: parent.name,
    })
    .from(categories)
    .innerJoin(parent, eq(parent.id, categories.parentId))
    .where(
      and(
        isNotNull(categories.parentId),
        eq(categories.archived, false),
        eq(parent.kind, "expense"),
      ),
    )
    .orderBy(categories.sort)
    .all();
}

function isLeaf(db: Db, categoryId: number): boolean {
  const row = db
    .select({ parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();
  return row !== undefined && row.parentId !== null;
}

function toDomain(row: typeof plannedExpenses.$inferSelect): PlannedExpense {
  return {
    id: row.id,
    name: row.name,
    amountCents: row.amountCents,
    dueDate: row.dueDate,
    every: row.every as Every,
    categoryId: row.categoryId,
    createdAt: row.createdAt,
    archived: row.archived,
  };
}

export function listPlanned(
  db: Db,
  opts: { includeArchived?: boolean } = {},
): PlannedExpense[] {
  return db
    .select()
    .from(plannedExpenses)
    .where(
      opts.includeArchived ? undefined : eq(plannedExpenses.archived, false),
    )
    .all()
    .map(toDomain);
}

export function createPlanned(
  db: Db,
  input: {
    name: string;
    amountCents: number;
    dueDate: string;
    every: Every;
    categoryId: number | null;
  },
): { ok: true; id: number } | Fail {
  if (input.categoryId !== null && !isLeaf(db, input.categoryId))
    return { ok: false, error: "Category must be a leaf category." };
  const [row] = db
    .insert(plannedExpenses)
    .values({
      name: input.name.trim(),
      amountCents: input.amountCents,
      dueDate: input.dueDate,
      every: input.every,
      categoryId: input.categoryId,
    })
    .returning({ id: plannedExpenses.id })
    .all();
  return { ok: true, id: row.id };
}

export function updatePlanned(
  db: Db,
  id: number,
  patch: Partial<{
    name: string;
    amountCents: number;
    dueDate: string;
    every: Every;
    categoryId: number | null;
  }>,
): { ok: true } | Fail {
  const existing = db
    .select()
    .from(plannedExpenses)
    .where(eq(plannedExpenses.id, id))
    .get();
  if (!existing) return { ok: false, error: "Planned expense not found." };
  if (
    patch.categoryId !== undefined &&
    patch.categoryId !== null &&
    !isLeaf(db, patch.categoryId)
  )
    return { ok: false, error: "Category must be a leaf category." };
  const set: Partial<typeof plannedExpenses.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.amountCents !== undefined) set.amountCents = patch.amountCents;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.every !== undefined) set.every = patch.every;
  if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
  if (Object.keys(set).length > 0)
    db.update(plannedExpenses).set(set).where(eq(plannedExpenses.id, id)).run();
  return { ok: true };
}

export function archivePlanned(db: Db, id: number): { ok: true } | Fail {
  const existing = db
    .select()
    .from(plannedExpenses)
    .where(eq(plannedExpenses.id, id))
    .get();
  if (!existing) return { ok: false, error: "Planned expense not found." };
  db.update(plannedExpenses)
    .set({ archived: true })
    .where(eq(plannedExpenses.id, id))
    .run();
  return { ok: true };
}
