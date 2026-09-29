import { and, eq, gt, gte, inArray, isNull, lt } from "drizzle-orm";
import { addDays } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";

const WINDOW_DAYS = 90;

export function findRefundCandidates(
  db: Db,
  opts: { transactionIds?: number[] } = {},
): number {
  const conds = [
    gt(transactions.amountCents, 0),
    eq(transactions.isTransfer, false),
    eq(transactions.reviewed, false),
    isNull(transactions.suspectedRefundOf),
  ];
  if (opts.transactionIds)
    conds.push(inArray(transactions.id, opts.transactionIds));
  const candidates = db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      amountCents: transactions.amountCents,
      merchant: transactions.merchant,
    })
    .from(transactions)
    .where(and(...conds))
    .all();
  let linked = 0;
  db.transaction((tx) => {
    for (const c of candidates) {
      const original = tx
        .select({ id: transactions.id, date: transactions.date })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, c.accountId),
            eq(transactions.merchant, c.merchant),
            eq(transactions.isTransfer, false),
            lt(transactions.amountCents, -c.amountCents + 1), // |amount| >= refund
            lt(transactions.date, c.date),
            gte(transactions.date, addDays(c.date, -WINDOW_DAYS)),
          ),
        )
        .all()
        .sort((x, y) => y.date.localeCompare(x.date) || y.id - x.id)[0];
      if (!original) continue;
      tx.update(transactions)
        .set({ suspectedRefundOf: original.id })
        .where(eq(transactions.id, c.id))
        .run();
      linked++;
    }
  });
  return linked;
}

export function confirmRefund(
  db: Db,
  id: number,
): { ok: true } | { ok: false; error: string } {
  const row = db
    .select({ suspectedRefundOf: transactions.suspectedRefundOf })
    .from(transactions)
    .where(eq(transactions.id, id))
    .get();
  if (!row || row.suspectedRefundOf === null)
    return { ok: false, error: "No refund link to confirm." };
  const original = db
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(eq(transactions.id, row.suspectedRefundOf))
    .get();
  if (!original)
    return { ok: false, error: "The original charge no longer exists." };
  // Inheriting "no category" would mark the refund reviewed while leaving it
  // uncategorized, quietly dropping it out of the queue for good.
  if (original.categoryId === null)
    return {
      ok: false,
      error:
        "The original charge isn't categorized yet — pick a category for this refund instead (press /).",
    };
  db.update(transactions)
    .set({ categoryId: original.categoryId, reviewed: true })
    .where(eq(transactions.id, id))
    .run();
  return { ok: true };
}

export function rejectRefund(db: Db, id: number): void {
  db.update(transactions)
    .set({ suspectedRefundOf: null })
    .where(eq(transactions.id, id))
    .run();
}
