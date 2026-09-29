import { and, eq, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "@/lib/db/client";
import { budgets, categories, goals } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import type { BudgetRow, LeafMeta } from "./types";

function incomeKey(month: string): string {
  return `budget_income:${month}`;
}

export function listBudgetLeaves(db: Db): LeafMeta[] {
  const parent = alias(categories, "parent");
  const rows = db
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      parentName: parent.name,
      parentSeedKey: parent.seedKey,
      parentSort: parent.sort,
      color: categories.color,
      isFixed: categories.isFixed,
      rollover: categories.rollover,
      sort: categories.sort,
      goalId: goals.id,
    })
    .from(categories)
    .innerJoin(parent, eq(parent.id, categories.parentId))
    .leftJoin(
      goals,
      and(eq(goals.categoryId, categories.id), eq(goals.archived, false)),
    )
    .where(
      and(
        isNotNull(categories.parentId),
        eq(parent.kind, "expense"),
        eq(categories.archived, false),
      ),
    )
    .orderBy(parent.sort, categories.sort)
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId as number,
    parentName: r.parentName as string,
    parentSeedKey: r.parentSeedKey,
    color: r.color,
    isFixed: r.isFixed,
    isSavings: r.parentSeedKey === "savings",
    rollover: r.rollover,
    sort: r.sort,
    parentSort: r.parentSort as number,
    goalId: r.goalId ?? null,
  }));
}

export function listBudgetRows(
  db: Db,
  opts: { month?: string } = {},
): BudgetRow[] {
  return db
    .select({
      month: budgets.month,
      categoryId: budgets.categoryId,
      amountCents: budgets.amountCents,
    })
    .from(budgets)
    .where(opts.month ? eq(budgets.month, opts.month) : undefined)
    .all();
}

export function budgetMonths(db: Db): string[] {
  const rows = db.selectDistinct({ month: budgets.month }).from(budgets).all();
  return [...new Set(rows.map((r) => r.month))].sort();
}

export function getBudgetIncome(db: Db, month: string): number | null {
  return getSetting<number | null>(db, incomeKey(month), null);
}

export function setBudgetIncome(db: Db, month: string, cents: number): void {
  setSetting(db, incomeKey(month), cents);
}

export function saveBudgetMonth(
  db: Db,
  month: string,
  rows: { categoryId: number; amountCents: number }[],
  incomeCents: number,
): void {
  db.transaction((tx) => {
    tx.delete(budgets).where(eq(budgets.month, month)).run();
    const nonZero = rows.filter((r) => r.amountCents !== 0);
    if (nonZero.length)
      tx.insert(budgets)
        .values(
          nonZero.map((r) => ({
            month,
            categoryId: r.categoryId,
            amountCents: r.amountCents,
          })),
        )
        .run();
    setSetting(tx as unknown as Db, incomeKey(month), incomeCents);
  });
}

/**
 * A 0 amount deletes the row rather than storing a zero-dollar budget — see
 * `carryFor`, which treats a month with no row for a leaf as a reset of that
 * leaf's rollover chain (carry restarts at 0 from the next row onward).
 */
export function setBudgetRow(
  db: Db,
  month: string,
  categoryId: number,
  amountCents: number,
): void {
  if (amountCents === 0) {
    db.delete(budgets)
      .where(and(eq(budgets.month, month), eq(budgets.categoryId, categoryId)))
      .run();
    return;
  }
  db.insert(budgets)
    .values({ month, categoryId, amountCents })
    .onConflictDoUpdate({
      target: [budgets.month, budgets.categoryId],
      set: { amountCents },
    })
    .run();
}

/** True iff every row's categoryId is a budgetable leaf (see `listBudgetLeaves`). */
export function validBudgetRows(
  db: Db,
  rows: { categoryId: number; amountCents: number }[],
): boolean {
  const ids = new Set(listBudgetLeaves(db).map((l) => l.id));
  return rows.every((r) => ids.has(r.categoryId));
}

export function copyBudgetMonth(
  db: Db,
  from: string,
  to: string,
): { ok: true; copied: number } | { ok: false; error: string } {
  return db.transaction((tx) => {
    const existing = tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(eq(budgets.month, to))
      .get();
    if (existing)
      return { ok: false, error: "That month already has a budget." };
    const rows = tx
      .select({
        categoryId: budgets.categoryId,
        amountCents: budgets.amountCents,
      })
      .from(budgets)
      .where(eq(budgets.month, from))
      .all();
    if (!rows.length) return { ok: false, error: "Nothing to copy." };
    tx.insert(budgets)
      .values(
        rows.map((r) => ({
          month: to,
          categoryId: r.categoryId,
          amountCents: r.amountCents,
        })),
      )
      .run();
    const income = getSetting<number | null>(
      tx as unknown as Db,
      incomeKey(from),
      null,
    );
    if (income !== null) setSetting(tx as unknown as Db, incomeKey(to), income);
    return { ok: true, copied: rows.length };
  });
}
