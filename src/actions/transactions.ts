"use server";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureDefaultCategories } from "@/lib/categories/ensure";
import { PARENT_COLORS } from "@/lib/categories/palette";
import { type Db, getDb } from "@/lib/db/client";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { refreshRecurring } from "@/lib/recurring/refresh";
import { listSplitsForTransactions, type SplitLine } from "@/lib/review/splits";
import { directionOf } from "@/lib/rules/engine";
import {
  applyCategoryToMerchant,
  countMerchantMatches,
  type PreviousCategories,
  restoreCategories,
} from "@/lib/transactions/merchant";
import {
  buildWhere,
  LIST_LIMIT,
  summarize,
  type TxnFilter,
  type TxnSummary,
} from "@/lib/transactions/summary";

export type { TxnFilter, TxnSummary } from "@/lib/transactions/summary";
export type TxnRow = {
  id: number;
  date: string;
  amountCents: number;
  merchant: string;
  rawDescription: string;
  accountId: number;
  accountName: string;
  accountColor: string;
  categoryId: number | null;
  categoryName: string;
  categoryColor: string;
  isTransfer: boolean;
  possibleDuplicate: boolean;
  pending: boolean;
  splitCount: number;
  splits: SplitLine[];
};

export async function listTransactions(f: TxnFilter = {}): Promise<TxnRow[]> {
  const db = getDb();
  ensureDefaultCategories(db);
  const rows = db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      merchant: transactions.merchant,
      rawDescription: transactions.rawDescription,
      accountId: transactions.accountId,
      accountName: accounts.name,
      accountColor: accounts.color,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      isTransfer: transactions.isTransfer,
      possibleDuplicate: transactions.possibleDuplicate,
      pending: transactions.pending,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(buildWhere(f))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(LIST_LIMIT)
    .all();
  const splits = listSplitsForTransactions(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const lines = splits.get(r.id) ?? [];
    return {
      ...r,
      categoryName: r.categoryName ?? "Uncategorized",
      categoryColor: r.categoryColor ?? PARENT_COLORS.uncategorized,
      splitCount: lines.length,
      splits: lines,
    };
  });
}

/**
 * Headline totals over every row the filter matches, not just the first
 * `LIST_LIMIT` returned by `listTransactions`.
 */
export async function summarizeTransactions(
  f: TxnFilter = {},
): Promise<TxnSummary> {
  const db = getDb();
  ensureDefaultCategories(db);
  return summarize(db, f);
}

export async function listCategoryOptions() {
  const db = getDb();
  ensureDefaultCategories(db);
  const parent = alias(categories, "parent");
  return db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      parentId: categories.parentId,
      parentName: parent.name,
    })
    .from(categories)
    .leftJoin(parent, eq(parent.id, categories.parentId))
    .where(and(isNotNull(categories.parentId), eq(categories.archived, false)))
    .orderBy(categories.sort)
    .all();
}

/** Active groups, for the "Food (all)" entries of the Transactions filter. */
export async function listCategoryGroupOptions() {
  return getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(isNull(categories.parentId), eq(categories.archived, false)))
    .orderBy(categories.sort)
    .all();
}

/**
 * One group by id, archived or not, so a `group` filter that points at a
 * group with no active leaves can still be named. `undefined` when the id is
 * not a group.
 */
export async function findCategoryGroupOption(id: number) {
  return getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.parentId)))
    .get();
}

const setCategoryArgs = z.object({
  id: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable(),
});

export type SetCategoryResult = { ok: true } | { ok: false; error: string };

/** Why a category cannot be assigned to a transaction, or null when it can. */
function leafCategoryError(db: Db, categoryId: number): string | null {
  const cat = db
    .select({ parentId: categories.parentId, archived: categories.archived })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();
  if (!cat) return "That category no longer exists.";
  if (cat.archived) return "That category is archived.";
  if (cat.parentId === null)
    return "Pick a specific category, not a top-level group.";
  return null;
}

export async function setTransactionCategory(
  id: number,
  categoryId: number | null,
): Promise<SetCategoryResult> {
  const parsed = setCategoryArgs.safeParse({ id, categoryId });
  if (!parsed.success)
    return { ok: false, error: "That category change wasn't valid." };
  const db = getDb();
  if (parsed.data.categoryId !== null) {
    const error = leafCategoryError(db, parsed.data.categoryId);
    if (error) return { ok: false, error };
  }
  const res = db
    .update(transactions)
    .set({ categoryId: parsed.data.categoryId, reviewed: true })
    .where(eq(transactions.id, parsed.data.id))
    .run();
  if (res.changes === 0)
    return { ok: false, error: "That transaction no longer exists." };
  refreshRecurring(db);
  revalidatePath("/transactions");
  revalidatePath("/bills");
  revalidatePath("/home");
  return { ok: true };
}

export type MerchantMatchCount = { total: number; sameCategory: number };

/**
 * How many other transactions share this row's merchant (non-transfer,
 * not split parents) — the N in "Apply <Category> to the other N ...?".
 */
export async function countMerchantMatchesAction(
  id: number,
): Promise<MerchantMatchCount> {
  const none = { total: 0, sameCategory: 0 };
  const parsed = z.number().int().positive().safeParse(id);
  if (!parsed.success) return none;
  const db = getDb();
  const txn = db
    .select({ merchant: transactions.merchant })
    .from(transactions)
    .where(eq(transactions.id, parsed.data))
    .get();
  if (!txn) return none;
  return countMerchantMatches(db, txn.merchant, parsed.data);
}

function refreshCategoryScreens() {
  for (const p of [
    "/transactions",
    "/review",
    "/bills",
    "/home",
    "/insights",
    "/budget",
  ])
    revalidatePath(p);
}

const applyToMerchantArgs = z.object({
  id: z.number().int().positive(),
  categoryId: z.number().int().positive(),
});
export type ApplyToMerchantResult =
  | { ok: true; applied: number; previous: PreviousCategories }
  | { ok: false; error: string };

/**
 * "Apply to all": every transaction at this row's merchant takes the category,
 * and a rule with the row's direction covers future imports. `previous` is
 * what `restoreCategoriesAction` needs to undo it.
 */
export async function applyCategoryToMerchantAction(input: {
  id: number;
  categoryId: number;
}): Promise<ApplyToMerchantResult> {
  const parsed = applyToMerchantArgs.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "That category change wasn't valid." };
  const db = getDb();
  const error = leafCategoryError(db, parsed.data.categoryId);
  if (error) return { ok: false, error };
  const txn = db
    .select({
      merchant: transactions.merchant,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(eq(transactions.id, parsed.data.id))
    .get();
  if (!txn) return { ok: false, error: "That transaction no longer exists." };
  const res = applyCategoryToMerchant(db, {
    merchant: txn.merchant,
    categoryId: parsed.data.categoryId,
    direction: directionOf(txn.amountCents),
  });
  refreshRecurring(db);
  refreshCategoryScreens();
  return { ok: true, ...res };
}

const previousArgs = z.array(
  z.tuple([
    z.number().int().positive(),
    z.number().int().positive().nullable(),
    z.boolean(),
  ]),
);
export async function restoreCategoriesAction(
  previous: PreviousCategories,
): Promise<SetCategoryResult> {
  const parsed = previousArgs.safeParse(previous);
  if (!parsed.success) return { ok: false, error: "That undo wasn't valid." };
  const db = getDb();
  restoreCategories(db, parsed.data);
  refreshRecurring(db);
  refreshCategoryScreens();
  return { ok: true };
}
