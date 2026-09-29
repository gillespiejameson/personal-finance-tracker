import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { buildWhere, summarize } from "@/lib/transactions/summary";

function setup() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  const [chk, sav] = db
    .insert(accounts)
    .values([
      { name: "Chk", type: "checking" },
      { name: "Sav", type: "savings" },
    ])
    .returning()
    .all();
  db.insert(transactions)
    .values([
      // income
      {
        accountId: chk.id,
        date: "2026-03-01",
        amountCents: 250_000,
        rawDescription: "PAYCHECK",
        merchant: "Employer",
        dedupeHash: "s1",
      },
      // two expenses, one of them still uncategorized
      {
        accountId: chk.id,
        date: "2026-03-02",
        amountCents: -1_250,
        rawDescription: "KROGER",
        merchant: "Kroger",
        dedupeHash: "s2",
      },
      {
        accountId: chk.id,
        date: "2026-03-03",
        amountCents: -4_075,
        rawDescription: "SHELL",
        merchant: "Shell",
        dedupeHash: "s3",
        categoryId: 3,
      },
      // a transfer: counted as a row, but never as spending or income
      {
        accountId: sav.id,
        date: "2026-03-04",
        amountCents: 40_000,
        rawDescription: "TRANSFER FROM CHK",
        merchant: "Transfer",
        dedupeHash: "s4",
        isTransfer: true,
        categoryId: 2,
      },
    ])
    .run();
  return { db, chk, sav };
}

describe("summarize", () => {
  it("totals spend and income in cents, excluding transfers", () => {
    const { db } = setup();
    expect(summarize(db)).toEqual({
      count: 4,
      spentCents: 5_325,
      receivedCents: 250_000,
      uncategorizedCount: 2,
    });
  });

  it("honors an account filter", () => {
    const { db, sav } = setup();
    expect(summarize(db, { accountId: sav.id })).toEqual({
      count: 1,
      spentCents: 0,
      receivedCents: 0,
      uncategorizedCount: 0,
    });
  });

  it("honors a date range filter", () => {
    const { db } = setup();
    expect(summarize(db, { from: "2026-03-02", to: "2026-03-03" })).toEqual({
      count: 2,
      spentCents: 5_325,
      receivedCents: 0,
      uncategorizedCount: 1,
    });
  });

  it("returns zeros when nothing matches", () => {
    const { db } = setup();
    expect(summarize(db, { from: "2027-01-01" })).toEqual({
      count: 0,
      spentCents: 0,
      receivedCents: 0,
      uncategorizedCount: 0,
    });
  });
});

describe("buildWhere group filter", () => {
  function withFoodRows() {
    const { db, chk } = setup();
    const groceries = findCategoryId(db, "Groceries") as number;
    const restaurants = findCategoryId(db, "Restaurants") as number;
    const fuel = findCategoryId(db, "Fuel") as number;
    const food = db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, "Food"))
      .get()?.id as number;
    db.insert(transactions)
      .values([
        {
          accountId: chk.id,
          date: "2026-03-05",
          amountCents: -2_000,
          rawDescription: "ALDI",
          merchant: "Aldi",
          dedupeHash: "g1",
          categoryId: groceries,
        },
        {
          accountId: chk.id,
          date: "2026-03-06",
          amountCents: -3_000,
          rawDescription: "CHIPOTLE",
          merchant: "Chipotle",
          dedupeHash: "g2",
          categoryId: restaurants,
        },
        {
          accountId: chk.id,
          date: "2026-03-07",
          amountCents: -4_000,
          rawDescription: "BP",
          merchant: "BP",
          dedupeHash: "g3",
          categoryId: fuel,
        },
      ])
      .run();
    return { db, food, groceries };
  }

  it("matches only leaves under the parent, not other groups or uncategorized rows", () => {
    const { db, food } = withFoodRows();
    const rows = db
      .select({ merchant: transactions.merchant })
      .from(transactions)
      .where(buildWhere({ parentId: food }))
      .all()
      .map((r) => r.merchant)
      .sort();
    expect(rows).toEqual(["Aldi", "Chipotle"]);
    expect(summarize(db, { parentId: food })).toEqual({
      count: 2,
      spentCents: 5_000,
      receivedCents: 0,
      uncategorizedCount: 0,
    });
  });

  it("composes with the other filters and with a leaf filter", () => {
    const { db, food, groceries } = withFoodRows();
    expect(summarize(db, { parentId: food, to: "2026-03-05" }).count).toBe(1);
    expect(summarize(db, { parentId: food, categoryId: groceries }).count).toBe(
      1,
    );
    expect(summarize(db, { parentId: 999_999 }).count).toBe(0);
  });
});
