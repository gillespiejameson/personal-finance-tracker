"use server";
import { eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listCategoryOptions } from "@/actions/transactions";
import { findCategoryId } from "@/lib/categories/ensure";
import { getDb } from "@/lib/db/client";
import { transactions, transferPairs } from "@/lib/db/schema";
import { type RerunReport, rerunDetection } from "@/lib/maintenance/rerun";
import { createAlias, validateAlias } from "@/lib/normalize/aliases";
import { refreshRecurring } from "@/lib/recurring/refresh";
import { confirmRefund, rejectRefund } from "@/lib/refunds/match";
import {
  listQueue,
  queueCount,
  type ReviewItem,
  type Suggestion,
  suggestCategories,
} from "@/lib/review/queue";
import { clearSplits, saveSplits } from "@/lib/review/splits";
import {
  applyRules,
  directionOf,
  ensureUserRule,
  previewRule,
} from "@/lib/rules/engine";

export type { ReviewItem, Suggestion };
export type CategoryOption = {
  id: number;
  name: string;
  color: string;
  parentName: string | null;
};
type Fail = { ok: false; error: string };

const id = z.number().int().positive();
const fieldEnum = z.enum(["merchant", "raw"]);

function refresh() {
  revalidatePath("/review");
  revalidatePath("/transactions");
  revalidatePath("/home");
  revalidatePath("/bills");
}

export async function getReviewPage(): Promise<{
  items: ReviewItem[];
  suggestions: Record<number, Suggestion[]>;
  count: number;
  categories: CategoryOption[];
}> {
  const db = getDb();
  const items = listQueue(db, { limit: 200 });
  const suggestions = Object.fromEntries(suggestCategories(db, items));
  return {
    items,
    suggestions,
    count: queueCount(db),
    categories: await listCategoryOptions(),
  };
}

const decideArgs = z.object({
  id,
  categoryId: id,
  always: z
    .object({ pattern: z.string().min(2).max(80), field: fieldEnum })
    .optional(),
});
export async function decideCategory(
  input: z.input<typeof decideArgs>,
): Promise<{ ok: true; ruleApplied?: number } | Fail> {
  const p = decideArgs.safeParse(input);
  if (!p.success) return { ok: false, error: "That change wasn't valid." };
  const db = getDb();
  const txn = db
    .select({ amountCents: transactions.amountCents })
    .from(transactions)
    .where(eq(transactions.id, p.data.id))
    .get();
  if (!txn) return { ok: false, error: "That transaction no longer exists." };
  db.update(transactions)
    .set({ categoryId: p.data.categoryId, reviewed: true })
    .where(eq(transactions.id, p.data.id))
    .run();
  let ruleApplied: number | undefined;
  if (p.data.always) {
    // A rule learned from a debit should not catch the merchant's credits
    // (a refund, or a payroll correction) and vice versa.
    ensureUserRule(
      db,
      {
        pattern: p.data.always.pattern,
        field: p.data.always.field,
        categoryId: p.data.categoryId,
      },
      { direction: directionOf(txn.amountCents) },
    );
    // Not just the uncategorized ones: an unreviewed row a weaker rule guessed
    // wrong is exactly what the user is correcting. Reviewed rows are never
    // touched, so their own decisions still stand.
    ruleApplied = applyRules(db, { onlyUncategorized: false }).applied;
  }
  refreshRecurring(db);
  refresh();
  return { ok: true, ruleApplied };
}

/**
 * How many rows the "always" rule would match. `amountCents` is the item the
 * rule is being learned from; the rule takes its direction, so the preview
 * must too or a merchant with both debits and credits over-counts.
 */
export async function previewAlways(input: {
  pattern: string;
  field: "merchant" | "raw";
  amountCents?: number;
}): Promise<number> {
  const p = z
    .object({
      pattern: z.string().min(2).max(80),
      field: fieldEnum,
      amountCents: z.number().int().optional(),
    })
    .safeParse(input);
  if (!p.success) return 0;
  const { amountCents, ...spec } = p.data;
  return previewRule(getDb(), {
    ...spec,
    matchType: "contains",
    direction: amountCents === undefined ? "any" : directionOf(amountCents),
  });
}

const restoreArgs = z.object({
  id,
  categoryId: z.number().int().positive().nullable(),
  reviewed: z.boolean(),
  isTransfer: z.boolean(),
  possibleDuplicate: z.boolean(),
});
/**
 * Put a row's four review-visible fields back the way they were, for the
 * review screen's undo stack.
 *
 * Transfer *pairs* are deliberately left alone: undo restores the row, it does
 * not re-link legs that `toggleTransfer` unpaired. Restoring a transfer mark
 * re-applies the Transfer category that the toggle would have given it.
 */
export async function restoreTransaction(
  input: z.input<typeof restoreArgs>,
): Promise<{ ok: true } | Fail> {
  const p = restoreArgs.safeParse(input);
  if (!p.success) return { ok: false, error: "That undo wasn't valid." };
  const db = getDb();
  const categoryId = p.data.isTransfer
    ? (findCategoryId(db, "Transfer") ?? p.data.categoryId)
    : p.data.categoryId;
  const res = db
    .update(transactions)
    .set({
      categoryId,
      reviewed: p.data.reviewed,
      isTransfer: p.data.isTransfer,
      possibleDuplicate: p.data.possibleDuplicate,
    })
    .where(eq(transactions.id, p.data.id))
    .run();
  if (res.changes === 0)
    return { ok: false, error: "That transaction no longer exists." };
  refresh();
  return { ok: true };
}

export async function toggleTransfer(
  input: number,
): Promise<{ ok: true; isTransfer: boolean } | Fail> {
  const p = id.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid id." };
  const db = getDb();
  const row = db
    .select({ isTransfer: transactions.isTransfer })
    .from(transactions)
    .where(eq(transactions.id, p.data))
    .get();
  if (!row) return { ok: false, error: "That transaction no longer exists." };
  const transferCat = findCategoryId(db, "Transfer");
  const next = !row.isTransfer;
  db.transaction((tx) => {
    if (next) {
      tx.update(transactions)
        .set({
          isTransfer: true,
          categoryId: transferCat ?? null,
          reviewed: true,
        })
        .where(eq(transactions.id, p.data))
        .run();
    } else {
      const pairs = tx
        .select()
        .from(transferPairs)
        .where(
          or(
            eq(transferPairs.fromTxnId, p.data),
            eq(transferPairs.toTxnId, p.data),
          ),
        )
        .all();
      const partners = pairs.map((x) =>
        x.fromTxnId === p.data ? x.toTxnId : x.fromTxnId,
      );
      for (const x of pairs)
        tx.delete(transferPairs).where(eq(transferPairs.id, x.id)).run();
      for (const pid of [p.data, ...partners])
        tx.update(transactions)
          .set({ isTransfer: false, categoryId: null, reviewed: false })
          .where(eq(transactions.id, pid))
          .run();
    }
  });
  refreshRecurring(db);
  refresh();
  return { ok: true, isTransfer: next };
}

export async function resolveDuplicate(input: {
  id: number;
  action: "keep" | "delete";
}): Promise<{ ok: true } | Fail> {
  const p = z
    .object({ id, action: z.enum(["keep", "delete"]) })
    .safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const db = getDb();
  if (p.data.action === "keep")
    db.update(transactions)
      .set({ possibleDuplicate: false })
      .where(eq(transactions.id, p.data.id))
      .run();
  else
    db.transaction((tx) => {
      // Drop refund links pointing at the copy first, or the surviving rows
      // would keep a suspected_refund_of that resolves to nothing.
      tx.update(transactions)
        .set({ suspectedRefundOf: null })
        .where(eq(transactions.suspectedRefundOf, p.data.id))
        .run();
      tx.delete(transactions).where(eq(transactions.id, p.data.id)).run();
    });
  if (p.data.action === "delete") refreshRecurring(db);
  refresh();
  return { ok: true };
}

export async function resolveRefund(input: {
  id: number;
  confirm: boolean;
}): Promise<{ ok: true } | Fail> {
  const p = z.object({ id, confirm: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const db = getDb();
  if (p.data.confirm) {
    const r = confirmRefund(db, p.data.id);
    if (!r.ok) return r;
  } else rejectRefund(db, p.data.id);
  refresh();
  return { ok: true };
}

const splitArgs = z.object({
  id,
  rows: z
    .array(z.object({ categoryId: id, amountCents: z.number().int() }))
    .min(2)
    .max(12),
});
export async function saveSplitsAction(
  input: z.input<typeof splitArgs>,
): Promise<{ ok: true } | Fail> {
  const p = splitArgs.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: "A split needs 2–12 lines with whole-cent amounts.",
    };
  const db = getDb();
  const r = saveSplits(db, p.data.id, p.data.rows);
  if (r.ok) {
    refreshRecurring(db);
    refresh();
  }
  return r;
}

export async function clearSplitsAction(
  input: number,
): Promise<{ ok: true } | Fail> {
  const p = id.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid id." };
  const db = getDb();
  clearSplits(db, p.data);
  refreshRecurring(db);
  refresh();
  return { ok: true };
}

export async function createAliasAction(input: {
  pattern: string;
  merchant: string;
}): Promise<{ ok: true; updated: number } | Fail> {
  const p = z
    .object({
      pattern: z.string().min(2).max(80),
      merchant: z.string().min(1).max(60),
    })
    .safeParse(input);
  if (!p.success)
    return { ok: false, error: "Alias needs a pattern (2+ chars) and a name." };
  const error = validateAlias({ pattern: p.data.pattern });
  if (error) return { ok: false, error };
  const db = getDb();
  const r = createAlias(db, p.data);
  refreshRecurring(db);
  refresh();
  return { ok: true, updated: r.updated };
}

export async function rerunDetectionAction(): Promise<RerunReport> {
  const r = rerunDetection(getDb());
  refresh();
  return r;
}
