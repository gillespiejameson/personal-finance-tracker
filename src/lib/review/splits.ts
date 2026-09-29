import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { categories, transactionSplits, transactions } from "@/lib/db/schema";

export type SplitInput = {
  categoryId: number;
  amountCents: number;
  notes?: string | null;
};
type Result = { ok: true } | { ok: false; error: string };

export function validateSplits(totalCents: number, rows: SplitInput[]): Result {
  if (rows.length < 2)
    return { ok: false, error: "A split needs at least two lines." };
  const sign = Math.sign(totalCents);
  for (const r of rows) {
    if (!Number.isInteger(r.amountCents) || r.amountCents === 0)
      return { ok: false, error: "Every line needs an amount." };
    if (Math.sign(r.amountCents) !== sign)
      return {
        ok: false,
        error: "Every line must have the same sign as the transaction.",
      };
  }
  const sum = rows.reduce((a, r) => a + r.amountCents, 0);
  if (sum !== totalCents)
    return {
      ok: false,
      error: `Lines add up to ${sum} cents, transaction is ${totalCents} cents.`,
    };
  return { ok: true };
}

export function listSplits(db: Db, transactionId: number) {
  return db
    .select({
      id: transactionSplits.id,
      categoryId: transactionSplits.categoryId,
      amountCents: transactionSplits.amountCents,
      notes: transactionSplits.notes,
    })
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, transactionId))
    .orderBy(transactionSplits.id)
    .all();
}

export function saveSplits(
  db: Db,
  transactionId: number,
  rows: SplitInput[],
): Result {
  const txn = db
    .select({ amountCents: transactions.amountCents })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .get();
  if (!txn) return { ok: false, error: "That transaction no longer exists." };
  const v = validateSplits(txn.amountCents, rows);
  if (!v.ok) return v;
  db.transaction((tx) => {
    tx.delete(transactionSplits)
      .where(eq(transactionSplits.transactionId, transactionId))
      .run();
    tx.insert(transactionSplits)
      .values(
        rows.map((r) => ({
          transactionId,
          categoryId: r.categoryId,
          amountCents: r.amountCents,
          notes: r.notes ?? null,
        })),
      )
      .run();
    tx.update(transactions)
      .set({ categoryId: null, reviewed: true })
      .where(eq(transactions.id, transactionId))
      .run();
  });
  return { ok: true };
}

export type SplitLine = {
  categoryName: string;
  color: string;
  amountCents: number;
};

/**
 * Split lines for a page of transactions, in one query — the transactions
 * table renders a whole page at a time and must not fan out per row.
 */
export function listSplitsForTransactions(
  db: Db,
  transactionIds: number[],
): Map<number, SplitLine[]> {
  const out = new Map<number, SplitLine[]>();
  if (transactionIds.length === 0) return out;
  const rows = db
    .select({
      transactionId: transactionSplits.transactionId,
      categoryName: categories.name,
      color: categories.color,
      amountCents: transactionSplits.amountCents,
    })
    .from(transactionSplits)
    .innerJoin(categories, eq(categories.id, transactionSplits.categoryId))
    .where(inArray(transactionSplits.transactionId, transactionIds))
    .orderBy(transactionSplits.id)
    .all();
  for (const { transactionId, ...line } of rows) {
    const list = out.get(transactionId);
    if (list) list.push(line);
    else out.set(transactionId, [line]);
  }
  return out;
}

/**
 * Drop a transaction's splits and hand the row back to the review queue: the
 * parent was marked reviewed with no category when the split was saved, so
 * leaving `reviewed` set would strand it as permanently uncategorized.
 */
export function clearSplits(db: Db, transactionId: number): void {
  db.transaction((tx) => {
    tx.delete(transactionSplits)
      .where(eq(transactionSplits.transactionId, transactionId))
      .run();
    tx.update(transactions)
      .set({ reviewed: false })
      .where(eq(transactions.id, transactionId))
      .run();
  });
}
