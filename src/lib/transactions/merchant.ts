import { and, eq, inArray, ne, notExists, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { rules, transactionSplits, transactions } from "@/lib/db/schema";
import { ensureUserRule, type RuleDirection } from "@/lib/rules/engine";

/** `[transactionId, previousCategoryId, previousReviewed]`, enough to undo an apply. */
export type PreviousCategories = [number, number | null, boolean][];

/**
 * Every non-transfer transaction at a merchant (normalized column, compared
 * case-insensitively) that is not a split parent — a parent's category lives
 * on its lines, so recategorizing it would only orphan the split.
 */
function merchantScope(db: Db, merchant: string) {
  return and(
    eq(sql`lower(${transactions.merchant})`, merchant.trim().toLowerCase()),
    eq(transactions.isTransfer, false),
    notExists(
      db
        .select({ one: sql`1` })
        .from(transactionSplits)
        .where(eq(transactionSplits.transactionId, transactions.id)),
    ),
  );
}

/**
 * How many other rows an apply-to-all would touch, and how many of them are
 * already in the excluded row's category.
 */
export function countMerchantMatches(
  db: Db,
  merchant: string,
  excludeId: number,
): { total: number; sameCategory: number } {
  const self = db
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(eq(transactions.id, excludeId))
    .get();
  if (!self) return { total: 0, sameCategory: 0 };
  const rows = db
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(and(merchantScope(db, merchant), ne(transactions.id, excludeId)))
    .all();
  return {
    total: rows.length,
    sameCategory: rows.filter((r) => r.categoryId === self.categoryId).length,
  };
}

/**
 * Put every transaction at the merchant into `categoryId`, reviewed ones
 * included — this is an explicit instruction, not a guess — and teach the
 * rule engine the same for future imports. A user rule already aimed at this
 * merchant for the same direction is re-pointed rather than left to compete
 * with a new one.
 */
export function applyCategoryToMerchant(
  db: Db,
  input: { merchant: string; categoryId: number; direction: RuleDirection },
): { applied: number; previous: PreviousCategories } {
  const pattern = input.merchant.trim();
  const rows = db
    .select({
      id: transactions.id,
      categoryId: transactions.categoryId,
      reviewed: transactions.reviewed,
    })
    .from(transactions)
    .where(merchantScope(db, pattern))
    .all();
  db.transaction((tx) => {
    if (rows.length > 0)
      tx.update(transactions)
        .set({ categoryId: input.categoryId, reviewed: true })
        .where(
          inArray(
            transactions.id,
            rows.map((r) => r.id),
          ),
        )
        .run();
    tx.update(rules)
      .set({ categoryId: input.categoryId, direction: input.direction })
      .where(
        and(
          eq(rules.builtin, false),
          eq(rules.enabled, true),
          eq(rules.field, "merchant"),
          eq(rules.matchType, "contains"),
          eq(sql`lower(${rules.pattern})`, pattern.toLowerCase()),
          or(eq(rules.direction, "any"), eq(rules.direction, input.direction)),
        ),
      )
      .run();
    ensureUserRule(
      tx as unknown as Db,
      { pattern, field: "merchant", categoryId: input.categoryId },
      { direction: input.direction },
    );
  });
  return {
    applied: rows.length,
    previous: rows.map((r) => [r.id, r.categoryId, r.reviewed]),
  };
}

/**
 * Undo for `applyCategoryToMerchant`: categories and `reviewed` go back, so
 * a row that was waiting in Review is waiting there again.
 */
export function restoreCategories(db: Db, previous: PreviousCategories): void {
  db.transaction((tx) => {
    for (const [id, categoryId, reviewed] of previous)
      tx.update(transactions)
        .set({ categoryId, reviewed })
        .where(eq(transactions.id, id))
        .run();
  });
}
