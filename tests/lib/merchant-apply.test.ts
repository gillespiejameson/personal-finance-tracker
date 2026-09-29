import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import {
  accounts,
  rules,
  transactionSplits,
  transactions,
} from "@/lib/db/schema";
import { listQueue, queueCount } from "@/lib/review/queue";
import {
  applyCategoryToMerchant,
  countMerchantMatches,
  restoreCategories,
} from "@/lib/transactions/merchant";
import { mustFind } from "../helpers";

const cat = (db: ReturnType<typeof openDb>, name: string) => {
  const id = findCategoryId(db, name);
  if (id === undefined) throw new Error(`missing category ${name}`);
  return id;
};

/**
 * Four Kroger rows plus a bystander: the one being edited (unreviewed,
 * uncategorized), one already reviewed in another category, one split parent
 * and one transfer. Merchant casing differs on purpose.
 */
function seed() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  const [a] = db
    .insert(accounts)
    .values({ name: "Chk", type: "checking" })
    .returning()
    .all();
  const general = cat(db, "General");
  const groceries = cat(db, "Groceries");
  const row = (
    hash: string,
    merchant: string,
    extra: Partial<typeof transactions.$inferInsert> = {},
  ) => ({
    accountId: a.id,
    date: "2026-03-01",
    amountCents: -4500,
    rawDescription: merchant.toUpperCase(),
    merchant,
    dedupeHash: hash,
    ...extra,
  });
  const ids = db
    .insert(transactions)
    .values([
      row("edited", "Kroger"),
      row("reviewed", "kroger", { categoryId: general, reviewed: true }),
      row("split", "KROGER", { reviewed: true }),
      row("transfer", "Kroger", { isTransfer: true, reviewed: true }),
      row("other", "H-E-B"),
    ])
    .returning({ id: transactions.id, dedupeHash: transactions.dedupeHash })
    .all();
  const id = (h: string) =>
    mustFind(ids, (r) => r.dedupeHash === h, `row ${h}`).id;
  db.insert(transactionSplits)
    .values([
      { transactionId: id("split"), categoryId: groceries, amountCents: -3000 },
      { transactionId: id("split"), categoryId: general, amountCents: -1500 },
    ])
    .run();
  return { db, id, general, groceries };
}

describe("countMerchantMatches", () => {
  it("counts the other non-transfer, non-split rows case-insensitively", () => {
    const { db, id, general } = seed();
    expect(countMerchantMatches(db, "Kroger", id("edited"))).toEqual({
      total: 1,
      sameCategory: 0,
    });
    // From the reviewed row's point of view the edited row is in a different
    // category; from a row already in General nothing else is.
    db.update(transactions).set({ categoryId: general }).run();
    expect(countMerchantMatches(db, "kroger", id("reviewed"))).toEqual({
      total: 1,
      sameCategory: 1,
    });
    expect(countMerchantMatches(db, "Nowhere", id("edited"))).toEqual({
      total: 0,
      sameCategory: 0,
    });
  });
});

describe("applyCategoryToMerchant / restoreCategories", () => {
  it("recategorizes every non-transfer non-split row, creates the rule and returns the previous state", () => {
    const { db, id, general, groceries } = seed();
    const res = applyCategoryToMerchant(db, {
      merchant: "kroger",
      categoryId: groceries,
      direction: "out",
    });
    expect(res.applied).toBe(2);
    expect(res.previous).toEqual(
      expect.arrayContaining([
        [id("edited"), null, false],
        [id("reviewed"), general, true],
      ]),
    );
    expect(res.previous).toHaveLength(2);
    const rows = db.select().from(transactions).all();
    const by = (h: string) =>
      mustFind(rows, (r) => r.dedupeHash === h, `row ${h}`);
    expect(by("edited")).toMatchObject({
      categoryId: groceries,
      reviewed: true,
    });
    expect(by("reviewed")).toMatchObject({
      categoryId: groceries,
      reviewed: true,
    });
    expect(by("split").categoryId).toBeNull();
    expect(by("transfer").categoryId).toBeNull();
    expect(by("other").categoryId).toBeNull();
    const rule = mustFind(
      db.select().from(rules).all(),
      (r) => !r.builtin,
      "the user rule",
    );
    expect(rule).toMatchObject({
      pattern: "kroger",
      field: "merchant",
      matchType: "contains",
      categoryId: groceries,
      direction: "out",
    });

    restoreCategories(db, res.previous);
    const after = db.select().from(transactions).all();
    const back = (h: string) =>
      mustFind(after, (r) => r.dedupeHash === h, `row ${h}`);
    expect(back("edited")).toMatchObject({ categoryId: null, reviewed: false });
    expect(back("reviewed")).toMatchObject({
      categoryId: general,
      reviewed: true,
    });
  });

  it("undo puts an unreviewed uncategorized row back in the review queue", () => {
    const { db, id, groceries } = seed();
    const before = queueCount(db);
    expect(listQueue(db).some((q) => q.id === id("edited"))).toBe(true);
    const res = applyCategoryToMerchant(db, {
      merchant: "Kroger",
      categoryId: groceries,
      direction: "out",
    });
    expect(queueCount(db)).toBe(before - 1);
    expect(listQueue(db).some((q) => q.id === id("edited"))).toBe(false);
    restoreCategories(db, res.previous);
    expect(queueCount(db)).toBe(before);
    expect(listQueue(db).some((q) => q.id === id("edited"))).toBe(true);
    // The row that had been reviewed before stays reviewed.
    expect(listQueue(db).some((q) => q.id === id("reviewed"))).toBe(false);
  });

  it("re-points an existing user rule for the merchant instead of adding a rival", () => {
    const { db, general, groceries } = seed();
    applyCategoryToMerchant(db, {
      merchant: "Kroger",
      categoryId: general,
      direction: "out",
    });
    applyCategoryToMerchant(db, {
      merchant: "Kroger",
      categoryId: groceries,
      direction: "out",
    });
    const user = db
      .select()
      .from(rules)
      .all()
      .filter((r) => !r.builtin);
    expect(user).toHaveLength(1);
    expect(user[0]).toMatchObject({ categoryId: groceries, direction: "out" });
  });
});
