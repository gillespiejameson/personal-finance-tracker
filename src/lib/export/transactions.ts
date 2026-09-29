import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "@/lib/db/client";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { listSplitsForTransactions } from "@/lib/review/splits";
import { buildWhere, type TxnFilter } from "@/lib/transactions/summary";
import { centsToDecimal, csvText, toCsv } from "./csv";

export const EXPORT_COLUMNS = [
  "date",
  "account",
  "merchant",
  "description",
  "amount",
  "category_group",
  "category",
  "transfer",
  "possible_duplicate",
  "splits",
];

/**
 * Every transaction the filter matches (no `LIST_LIMIT`), one row per
 * transaction with its splits summarized into the last column, ordered by
 * date then id descending — the same order the Transactions list uses.
 */
export function exportTransactions(db: Db, f: TxnFilter = {}): string[][] {
  const parent = alias(categories, "parent");
  const rows = db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      merchant: transactions.merchant,
      rawDescription: transactions.rawDescription,
      accountName: accounts.name,
      categoryName: categories.name,
      parentName: parent.name,
      isTransfer: transactions.isTransfer,
      possibleDuplicate: transactions.possibleDuplicate,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(parent, eq(parent.id, categories.parentId))
    .where(buildWhere(f))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .all();
  const splits = listSplitsForTransactions(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const lines = splits.get(r.id) ?? [];
    const splitStr = lines
      .map((l) => `${l.categoryName} ${centsToDecimal(l.amountCents)}`)
      .join("; ");
    return [
      r.date,
      csvText(r.accountName),
      csvText(r.merchant),
      csvText(r.rawDescription),
      centsToDecimal(r.amountCents),
      csvText(
        r.categoryName === null
          ? "Uncategorized"
          : (r.parentName ?? r.categoryName),
      ),
      csvText(r.categoryName ?? ""),
      r.isTransfer ? "yes" : "no",
      r.possibleDuplicate ? "yes" : "no",
      csvText(splitStr),
    ];
  });
}

export function transactionsCsv(db: Db, f: TxnFilter = {}): string {
  return toCsv(EXPORT_COLUMNS, exportTransactions(db, f));
}

/**
 * `transactions-<from>-<to>.csv`, with `all` filling in either missing
 * bound — collapsing to `transactions-all` when neither is set — then one
 * segment per other filter, so two exports taken with different filters
 * never land on the same name in the downloads folder.
 */
export function exportFilename(f: TxnFilter = {}): string {
  const base =
    !f.from && !f.to
      ? "transactions-all"
      : `transactions-${f.from ?? "all"}-${f.to ?? "all"}`;
  const parts = [
    f.accountId !== undefined ? `account-${f.accountId}` : null,
    f.parentId !== undefined ? `group-${f.parentId}` : null,
    f.categoryId !== undefined ? `category-${f.categoryId}` : null,
    f.q
      ? f.q
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 24) || null
      : null,
  ].filter((p): p is string => p !== null);
  return `${[base, ...parts].join("-")}.csv`;
}
