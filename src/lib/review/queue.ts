import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "@/lib/db/client";
import { accounts, categories, transactions } from "@/lib/db/schema";

export type ReviewItem = {
  id: number;
  date: string;
  amountCents: number;
  merchant: string;
  rawDescription: string;
  accountId: number;
  accountName: string;
  accountColor: string;
  accountType: string;
  categoryId: number | null;
  isTransfer: boolean;
  possibleDuplicate: boolean;
  pending: boolean;
  suspectedRefundOf: number | null;
  refundOf: {
    id: number;
    date: string;
    amountCents: number;
    categoryName: string | null;
  } | null;
  reason: "uncategorized" | "duplicate" | "refund";
};
export type Suggestion = {
  categoryId: number;
  name: string;
  color: string;
  parentName: string;
  why: "merchant" | "amount" | "recent";
};

const inQueue = and(
  eq(transactions.isTransfer, false),
  eq(transactions.reviewed, false),
  or(
    isNull(transactions.categoryId),
    eq(transactions.possibleDuplicate, true),
    isNotNull(transactions.suspectedRefundOf),
  ),
);

export function queueCount(db: Db): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .where(inQueue)
      .get()?.n ?? 0
  );
}

export function listQueue(db: Db, opts: { limit?: number } = {}): ReviewItem[] {
  const orig = alias(transactions, "orig");
  const origCat = alias(categories, "orig_cat");
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
      accountType: accounts.type,
      categoryId: transactions.categoryId,
      isTransfer: transactions.isTransfer,
      possibleDuplicate: transactions.possibleDuplicate,
      pending: transactions.pending,
      suspectedRefundOf: transactions.suspectedRefundOf,
      origId: orig.id,
      origDate: orig.date,
      origAmount: orig.amountCents,
      origCategoryName: origCat.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(orig, eq(orig.id, transactions.suspectedRefundOf))
    .leftJoin(origCat, eq(origCat.id, orig.categoryId))
    .where(inQueue)
    .orderBy(transactions.date, transactions.id)
    .limit(opts.limit ?? 200)
    .all();
  return rows.map(
    ({ origId, origDate, origAmount, origCategoryName, ...r }) => ({
      ...r,
      refundOf:
        origId !== null && origDate !== null && origAmount !== null
          ? {
              id: origId,
              date: origDate,
              amountCents: origAmount,
              categoryName: origCategoryName,
            }
          : null,
      reason:
        r.suspectedRefundOf !== null
          ? "refund"
          : r.possibleDuplicate
            ? "duplicate"
            : "uncategorized",
    }),
  );
}

type CatInfo = { id: number; name: string; color: string; parentName: string };

function categoryInfo(db: Db): Map<number, CatInfo> {
  const parent = alias(categories, "parent");
  const rows = db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      parentName: parent.name,
    })
    .from(categories)
    .leftJoin(parent, eq(parent.id, categories.parentId))
    .where(isNotNull(categories.parentId))
    .all();
  return new Map(
    rows.map((r) => [r.id, { ...r, parentName: r.parentName ?? "" }]),
  );
}

export function suggestCategories(
  db: Db,
  items: ReviewItem[],
): Map<number, Suggestion[]> {
  const cats = categoryInfo(db);
  const history = db
    .select({
      id: transactions.id,
      merchant: transactions.merchant,
      accountId: transactions.accountId,
      amountCents: transactions.amountCents,
      categoryId: transactions.categoryId,
      reviewed: transactions.reviewed,
    })
    .from(transactions)
    .where(
      and(
        isNotNull(transactions.categoryId),
        eq(transactions.isTransfer, false),
      ),
    )
    .orderBy(desc(transactions.id))
    .all() as {
    id: number;
    merchant: string;
    accountId: number;
    amountCents: number;
    categoryId: number;
    reviewed: boolean;
  }[];

  const recent: number[] = [];
  for (const h of history)
    if (h.reviewed && !recent.includes(h.categoryId)) recent.push(h.categoryId);

  const topBy = (rows: typeof history) => {
    const counts = new Map<number, { n: number; latest: number }>();
    for (const r of rows) {
      const c = counts.get(r.categoryId) ?? { n: 0, latest: 0 };
      counts.set(r.categoryId, {
        n: c.n + 1,
        latest: Math.max(c.latest, r.id),
      });
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].n - a[1].n || b[1].latest - a[1].latest)
      .map(([id]) => id);
  };

  const out = new Map<number, Suggestion[]>();
  for (const item of items) {
    const picked: Suggestion[] = [];
    const add = (categoryId: number, why: Suggestion["why"]) => {
      const c = cats.get(categoryId);
      if (
        !c ||
        picked.some((p) => p.categoryId === categoryId) ||
        picked.length >= 3
      )
        return;
      picked.push({
        categoryId,
        name: c.name,
        color: c.color,
        parentName: c.parentName,
        why,
      });
    };
    for (const id of topBy(
      history.filter((h) => h.merchant === item.merchant && h.id !== item.id),
    ))
      add(id, "merchant");
    const abs = Math.abs(item.amountCents);
    for (const id of topBy(
      history.filter(
        (h) =>
          h.id !== item.id &&
          h.accountId === item.accountId &&
          Math.abs(Math.abs(h.amountCents) - abs) <= abs * 0.2,
      ),
    ))
      add(id, "amount");
    for (const id of recent) add(id, "recent");
    out.set(item.id, picked);
  }
  return out;
}
