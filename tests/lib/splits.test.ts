import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { accounts, transactionSplits, transactions } from "@/lib/db/schema";
import {
  clearSplits,
  listSplits,
  listSplitsForTransactions,
  saveSplits,
  validateSplits,
} from "@/lib/review/splits";
import { mustFind } from "../helpers";

describe("validateSplits", () => {
  it("requires two or more rows that sum exactly and share the sign", () => {
    expect(
      validateSplits(-21000, [
        { categoryId: 1, amountCents: -15000 },
        { categoryId: 2, amountCents: -6000 },
      ]),
    ).toEqual({ ok: true });
    expect(
      validateSplits(-21000, [{ categoryId: 1, amountCents: -21000 }]),
    ).toMatchObject({ ok: false });
    expect(
      validateSplits(-21000, [
        { categoryId: 1, amountCents: -15000 },
        { categoryId: 2, amountCents: -5999 },
      ]),
    ).toMatchObject({ ok: false });
    expect(
      validateSplits(-21000, [
        { categoryId: 1, amountCents: -22000 },
        { categoryId: 2, amountCents: 1000 },
      ]),
    ).toMatchObject({ ok: false });
    expect(
      validateSplits(-21000, [
        { categoryId: 1, amountCents: 0 },
        { categoryId: 2, amountCents: -21000 },
      ]),
    ).toMatchObject({ ok: false });
  });
});

describe("saveSplits", () => {
  it("replaces splits atomically and marks the parent reviewed with no category", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const g = findCategoryId(db, "Groceries") as number;
    const h = findCategoryId(db, "Repairs & household") as number;
    const [a] = db
      .insert(accounts)
      .values({ name: "A", type: "credit" })
      .returning()
      .all();
    const [t] = db
      .insert(transactions)
      .values({
        accountId: a.id,
        date: "2026-06-01",
        amountCents: -21000,
        rawDescription: "COSTCO",
        merchant: "Costco",
        dedupeHash: "c",
        categoryId: g,
      })
      .returning()
      .all();
    expect(
      saveSplits(db, t.id, [
        { categoryId: g, amountCents: -15000 },
        { categoryId: h, amountCents: -6000 },
      ]),
    ).toEqual({ ok: true });
    expect(
      saveSplits(db, t.id, [
        { categoryId: g, amountCents: -20000 },
        { categoryId: h, amountCents: -1000 },
      ]),
    ).toEqual({ ok: true });
    expect(listSplits(db, t.id).map((s) => s.amountCents)).toEqual([
      -20000, -1000,
    ]);
    const parent = mustFind(
      db.select().from(transactions).all(),
      (r) => r.id === t.id,
    );
    expect(parent).toMatchObject({ categoryId: null, reviewed: true });
    expect(
      saveSplits(db, t.id, [
        { categoryId: g, amountCents: -1 },
        { categoryId: h, amountCents: -1 },
      ]),
    ).toMatchObject({ ok: false });
    expect(listSplits(db, t.id)).toHaveLength(2); // failed save left the previous splits intact
    expect(
      listSplitsForTransactions(db, [t.id])
        .get(t.id)
        ?.map((s) => [s.categoryName, s.amountCents]),
    ).toEqual([
      ["Groceries", -20000],
      ["Repairs & household", -1000],
    ]);
    // Each line carries its own row id, a stable React key for the table.
    expect(
      listSplitsForTransactions(db, [t.id])
        .get(t.id)
        ?.map((s) => s.id),
    ).toEqual(
      db
        .select()
        .from(transactionSplits)
        .orderBy(transactionSplits.id)
        .all()
        .map((s) => s.id),
    );
    expect(listSplitsForTransactions(db, []).size).toBe(0);

    clearSplits(db, t.id);
    expect(db.select().from(transactionSplits).all()).toHaveLength(0);
    // Unsplitting hands the row back to the review queue: it was marked
    // reviewed with no category when the split was saved.
    expect(
      mustFind(db.select().from(transactions).all(), (x) => x.id === t.id),
    ).toMatchObject({ categoryId: null, reviewed: false });
    expect(
      saveSplits(db, 999, [
        { categoryId: g, amountCents: -1 },
        { categoryId: h, amountCents: -1 },
      ]),
    ).toMatchObject({ ok: false });
  });
});
