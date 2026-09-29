import { and, eq, gte, lte, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { categories, transactions } from "@/lib/db/schema";
import { escapeLike } from "@/lib/sqlLike";

export type TxnFilter = {
  accountId?: number;
  from?: string;
  to?: string;
  categoryId?: number;
  /** Any leaf under this group (the `group` query param). */
  parentId?: number;
  q?: string;
};

/** Rows returned by one page of the transactions list. */
export const LIST_LIMIT = 5000;

export type TxnSummary = {
  count: number;
  spentCents: number;
  receivedCents: number;
  uncategorizedCount: number;
};

/**
 * The single `where` shared by the list query and the aggregate query, so the
 * headline numbers always describe exactly the rows the filters select — not
 * just the first page of them.
 */
export function buildWhere(f: TxnFilter = {}): SQL | undefined {
  const pattern = f.q ? `%${escapeLike(f.q)}%` : undefined;
  return and(
    f.accountId ? eq(transactions.accountId, f.accountId) : undefined,
    f.from ? gte(transactions.date, f.from) : undefined,
    f.to ? lte(transactions.date, f.to) : undefined,
    f.categoryId ? eq(transactions.categoryId, f.categoryId) : undefined,
    f.parentId
      ? sql`${transactions.categoryId} IN (SELECT ${categories.id} FROM ${categories} WHERE ${categories.parentId} = ${f.parentId})`
      : undefined,
    pattern
      ? or(
          sql`${transactions.merchant} LIKE ${pattern} ESCAPE '\\'`,
          sql`${transactions.rawDescription} LIKE ${pattern} ESCAPE '\\'`,
        )
      : undefined,
  );
}

/**
 * Totals over every matching row, computed in SQL. Transfers are money moving
 * between the user's own accounts, so they count towards `count` but never
 * towards spent/received. `spentCents` and `receivedCents` are magnitudes
 * (both non-negative).
 */
export function summarize(db: Db, f: TxnFilter = {}): TxnSummary {
  const notTransfer = sql`${transactions.isTransfer} = 0`;
  const row = db
    .select({
      count: sql<number>`count(*)`,
      spentCents: sql<number>`coalesce(sum(case when ${notTransfer} and ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end), 0)`,
      receivedCents: sql<number>`coalesce(sum(case when ${notTransfer} and ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end), 0)`,
      uncategorizedCount: sql<number>`coalesce(sum(case when ${notTransfer} and ${transactions.categoryId} is null then 1 else 0 end), 0)`,
    })
    .from(transactions)
    .where(buildWhere(f))
    .get();
  return (
    row ?? {
      count: 0,
      spentCents: 0,
      receivedCents: 0,
      uncategorizedCount: 0,
    }
  );
}
