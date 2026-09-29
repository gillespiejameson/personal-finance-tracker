import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";
import { listQueue, queueCount, suggestCategories } from "@/lib/review/queue";
import { mustFind } from "../helpers";

describe("review queue", () => {
  it("lists uncategorized, duplicate and refund rows with reasons, oldest first, and suggests categories", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const groceries = findCategoryId(db, "Groceries") as number;
    const restaurants = findCategoryId(db, "Restaurants") as number;
    const coffee = findCategoryId(db, "Coffee & takeout") as number;
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    db.insert(transactions)
      .values([
        // history that drives suggestions
        {
          accountId: a.id,
          date: "2026-05-01",
          amountCents: -5000,
          rawDescription: "H-E-B",
          merchant: "H-E-B",
          dedupeHash: "h1",
          categoryId: groceries,
          reviewed: true,
        },
        {
          accountId: a.id,
          date: "2026-05-02",
          amountCents: -5200,
          rawDescription: "H-E-B",
          merchant: "H-E-B",
          dedupeHash: "h2",
          categoryId: groceries,
          reviewed: true,
        },
        {
          accountId: a.id,
          date: "2026-05-03",
          amountCents: -4900,
          rawDescription: "H-E-B",
          merchant: "H-E-B",
          dedupeHash: "h3",
          categoryId: restaurants,
          reviewed: true,
        },
        {
          accountId: a.id,
          date: "2026-05-04",
          amountCents: -450,
          rawDescription: "STARBUCKS",
          merchant: "Starbucks",
          dedupeHash: "h4",
          categoryId: coffee,
          reviewed: true,
        },
        // queue
        {
          accountId: a.id,
          date: "2026-06-03",
          amountCents: -5100,
          rawDescription: "H-E-B #042",
          merchant: "H-E-B",
          dedupeHash: "q1",
        },
        {
          accountId: a.id,
          date: "2026-06-01",
          amountCents: -470,
          rawDescription: "NEW CAFE",
          merchant: "New Cafe",
          dedupeHash: "q2",
        },
        {
          accountId: a.id,
          date: "2026-06-02",
          amountCents: -470,
          rawDescription: "NEW CAFE",
          merchant: "New Cafe",
          dedupeHash: "q3",
          possibleDuplicate: true,
          categoryId: coffee,
        },
        {
          accountId: a.id,
          date: "2026-06-04",
          amountCents: 5100,
          rawDescription: "Refund H-E-B",
          merchant: "H-E-B",
          dedupeHash: "q4",
          suspectedRefundOf: 5,
        },
        // excluded
        {
          accountId: a.id,
          date: "2026-06-05",
          amountCents: -100,
          rawDescription: "T",
          merchant: "T",
          dedupeHash: "x1",
          isTransfer: true,
        },
        {
          accountId: a.id,
          date: "2026-06-06",
          amountCents: -100,
          rawDescription: "R",
          merchant: "R",
          dedupeHash: "x2",
          reviewed: true,
        },
      ])
      .run();

    expect(queueCount(db)).toBe(4);
    const q = listQueue(db);
    expect(q.map((i) => i.rawDescription)).toEqual([
      "NEW CAFE",
      "NEW CAFE",
      "H-E-B #042",
      "Refund H-E-B",
    ]);
    expect(q.map((i) => i.reason)).toEqual([
      "uncategorized",
      "duplicate",
      "uncategorized",
      "refund",
    ]);
    const refund = mustFind(q, (i) => i.reason === "refund");
    expect(refund.refundOf).toMatchObject({ id: 5, amountCents: -5100 });

    const s = suggestCategories(db, q);
    const heb = mustFind(q, (i) => i.rawDescription === "H-E-B #042");
    expect(s.get(heb.id)?.[0]).toMatchObject({
      categoryId: groceries,
      why: "merchant",
    });
    expect(s.get(heb.id)?.map((x) => x.categoryId)).toContain(restaurants);
    const cafe = mustFind(
      q,
      (i) => i.rawDescription === "NEW CAFE" && i.date === "2026-06-01",
    );
    // the duplicate copy (id 7) already carries Coffee, so the same-merchant signal wins over the amount band
    expect(s.get(cafe.id)?.[0]).toMatchObject({
      categoryId: coffee,
      why: "merchant",
    });
    const dup = mustFind(q, (i) => i.reason === "duplicate");
    expect(s.get(dup.id)?.[0]).toMatchObject({
      categoryId: coffee,
      why: "amount",
    }); // -470 is within 20% of Starbucks -450
    for (const list of s.values()) {
      expect(list.length).toBeLessThanOrEqual(3);
      expect(new Set(list.map((x) => x.categoryId)).size).toBe(list.length);
    }
  });

  it("an already-categorized queue row does not vote for itself", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const fun = findCategoryId(db, "Entertainment") as number;
    const coffee = findCategoryId(db, "Coffee & takeout") as number;
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    db.insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-05-04",
          amountCents: -450,
          rawDescription: "STARBUCKS",
          merchant: "Starbucks",
          dedupeHash: "h1",
          categoryId: coffee,
          reviewed: true,
        },
        {
          accountId: a.id,
          date: "2026-06-02",
          amountCents: -470,
          rawDescription: "NEW CAFE",
          merchant: "New Cafe",
          dedupeHash: "q1",
          possibleDuplicate: true,
          categoryId: fun,
        },
      ])
      .run();
    const q = listQueue(db);
    const dup = mustFind(q, (i) => i.reason === "duplicate");
    const s = suggestCategories(db, q).get(dup.id) ?? [];
    expect(s[0]).toMatchObject({ categoryId: coffee, why: "amount" });
    expect(
      s.filter((x) => x.why === "amount").map((x) => x.categoryId),
    ).not.toContain(fun);
  });
});
