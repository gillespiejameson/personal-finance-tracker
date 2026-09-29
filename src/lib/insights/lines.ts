import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { PARENT_COLORS } from "@/lib/categories/palette";
import type { Db } from "@/lib/db/client";
import { categories, transactionSplits, transactions } from "@/lib/db/schema";

export type Line = {
  txnId: number;
  date: string;
  month: string;
  amountCents: number;
  merchant: string;
  accountId: number;
  categoryId: number | null;
  leafName: string;
  leafSeedKey: string | null;
  isFixed: boolean;
  parentId: number | null;
  parentName: string;
  parentSeedKey: string | null;
  parentKind: "income" | "expense" | "transfer" | "system";
  color: string;
};

type CatMeta = {
  id: number;
  name: string;
  seedKey: string | null;
  isFixed: boolean;
  parentId: number | null;
  parentName: string;
  parentSeedKey: string | null;
  parentKind: Line["parentKind"];
  color: string;
};

function categoryMeta(db: Db): Map<number, CatMeta> {
  const parent = alias(categories, "parent");
  const rows = db
    .select({
      id: categories.id,
      name: categories.name,
      seedKey: categories.seedKey,
      isFixed: categories.isFixed,
      parentId: categories.parentId,
      color: categories.color,
      kind: categories.kind,
      parentName: parent.name,
      parentSeedKey: parent.seedKey,
      parentKind: parent.kind,
    })
    .from(categories)
    .leftJoin(parent, eq(parent.id, categories.parentId))
    .all();
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        seedKey: r.seedKey,
        isFixed: r.isFixed,
        parentId: r.parentId,
        parentName: r.parentName ?? r.name,
        parentSeedKey: r.parentSeedKey ?? r.seedKey,
        parentKind: (r.parentKind ?? r.kind) as Line["parentKind"],
        color: r.color,
      },
    ]),
  );
}

function meta(cats: Map<number, CatMeta>, categoryId: number | null) {
  const c = categoryId === null ? undefined : cats.get(categoryId);
  if (!c)
    return {
      categoryId: null,
      leafName: "Uncategorized",
      leafSeedKey: null,
      isFixed: false,
      parentId: null,
      parentName: "Uncategorized",
      parentSeedKey: null,
      parentKind: "system" as const,
      color: PARENT_COLORS.uncategorized,
    };
  return {
    categoryId: c.id,
    leafName: c.name,
    leafSeedKey: c.seedKey,
    isFixed: c.isFixed,
    parentId: c.parentId,
    parentName: c.parentName,
    parentSeedKey: c.parentSeedKey,
    parentKind: c.parentKind,
    color: c.color,
  };
}

export function loadLines(
  db: Db,
  range: { from?: string; to?: string } = {},
): Line[] {
  const cats = categoryMeta(db);
  const txns = db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      merchant: transactions.merchant,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.isTransfer, false),
        range.from ? gte(transactions.date, range.from) : undefined,
        range.to ? lte(transactions.date, range.to) : undefined,
      ),
    )
    .all();
  if (txns.length === 0) return [];
  const splits = db
    .select()
    .from(transactionSplits)
    .where(
      inArray(
        transactionSplits.transactionId,
        txns.map((t) => t.id),
      ),
    )
    .all();
  const byTxn = new Map<number, typeof splits>();
  for (const s of splits)
    byTxn.set(s.transactionId, [...(byTxn.get(s.transactionId) ?? []), s]);
  const out: Line[] = [];
  for (const t of txns) {
    const month = t.date.slice(0, 7);
    const parts = byTxn.get(t.id);
    if (parts && parts.length > 0) {
      for (const s of parts)
        out.push({
          txnId: t.id,
          date: t.date,
          month,
          amountCents: s.amountCents,
          merchant: t.merchant,
          accountId: t.accountId,
          ...meta(cats, s.categoryId),
        });
    } else {
      out.push({
        txnId: t.id,
        date: t.date,
        month,
        amountCents: t.amountCents,
        merchant: t.merchant,
        accountId: t.accountId,
        ...meta(cats, t.categoryId),
      });
    }
  }
  return out;
}
