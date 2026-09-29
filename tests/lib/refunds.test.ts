import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";
import {
  confirmRefund,
  findRefundCandidates,
  rejectRefund,
} from "@/lib/refunds/match";
import { mustFind } from "../helpers";

describe("refund matching", () => {
  it("links a positive row to the most recent same-merchant charge within 90 days, same account only", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const groceries = findCategoryId(db, "Groceries") as number;
    const [a] = db
      .insert(accounts)
      .values({ name: "A", type: "checking" })
      .returning()
      .all();
    const [b] = db
      .insert(accounts)
      .values({ name: "B", type: "credit" })
      .returning()
      .all();
    db.insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-01-01",
          amountCents: -5000,
          rawDescription: "OLD",
          merchant: "Banjo Barn",
          dedupeHash: "1",
        },
        {
          accountId: a.id,
          date: "2026-06-01",
          amountCents: -64321,
          rawDescription: "BANJO BARN",
          merchant: "Banjo Barn",
          dedupeHash: "2",
          categoryId: groceries,
        },
        {
          accountId: a.id,
          date: "2026-06-20",
          amountCents: -100,
          rawDescription: "BANJO BARN",
          merchant: "Banjo Barn",
          dedupeHash: "3",
        },
        {
          accountId: a.id,
          date: "2026-08-25",
          amountCents: 64321,
          rawDescription: "Refund SP BANJO BARN",
          merchant: "Banjo Barn",
          dedupeHash: "4",
        },
        {
          accountId: b.id,
          date: "2026-08-26",
          amountCents: 64321,
          rawDescription: "Refund SP BANJO BARN",
          merchant: "Banjo Barn",
          dedupeHash: "5",
        },
        {
          accountId: a.id,
          date: "2026-08-27",
          amountCents: 2000,
          rawDescription: "PAYROLL",
          merchant: "Acme Payroll",
          dedupeHash: "6",
        },
      ])
      .run();
    expect(findRefundCandidates(db)).toBe(1);
    const rows = db.select().from(transactions).all();
    const refund = mustFind(rows, (r) => r.dedupeHash === "4");
    const original = mustFind(rows, (r) => r.dedupeHash === "2");
    expect(refund.suspectedRefundOf).toBe(original.id); // 6/20 charge is too small; 1/1 is too old
    expect(
      mustFind(rows, (r) => r.dedupeHash === "5").suspectedRefundOf,
    ).toBeNull();
    expect(
      mustFind(rows, (r) => r.dedupeHash === "6").suspectedRefundOf,
    ).toBeNull();
    expect(findRefundCandidates(db)).toBe(0); // idempotent

    expect(confirmRefund(db, refund.id)).toEqual({ ok: true });
    const after = mustFind(
      db.select().from(transactions).all(),
      (r) => r.id === refund.id,
    );
    expect(after.categoryId).toBe(groceries);
    expect(after.reviewed).toBe(true);

    rejectRefund(db, refund.id);
    expect(
      mustFind(db.select().from(transactions).all(), (r) => r.id === refund.id)
        .suspectedRefundOf,
    ).toBeNull();
    expect(confirmRefund(db, 999)).toMatchObject({ ok: false });
  });

  it("refuses to confirm against an original that has no category", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [a] = db
      .insert(accounts)
      .values({ name: "A", type: "checking" })
      .returning()
      .all();
    db.insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-06-01",
          amountCents: -4500,
          rawDescription: "SHOP",
          merchant: "Shop",
          dedupeHash: "o",
        },
        {
          accountId: a.id,
          date: "2026-06-06",
          amountCents: 4500,
          rawDescription: "Refund Shop",
          merchant: "Shop",
          dedupeHash: "r",
        },
      ])
      .run();
    expect(findRefundCandidates(db)).toBe(1);
    const refund = mustFind(
      db.select().from(transactions).all(),
      (r) => r.dedupeHash === "r",
    );
    expect(confirmRefund(db, refund.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining("isn't categorized yet"),
    });
    // Left alone, so it stays in the queue for the user to categorize.
    const after = mustFind(
      db.select().from(transactions).all(),
      (r) => r.id === refund.id,
    );
    expect(after).toMatchObject({ reviewed: false, categoryId: null });
    expect(after.suspectedRefundOf).not.toBeNull();
  });

  it("ignores charges older than 90 days and transfers, even when amounts qualify", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [a] = db
      .insert(accounts)
      .values({ name: "A", type: "checking" })
      .returning()
      .all();
    db.insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-01-01",
          amountCents: -9000,
          rawDescription: "OLD",
          merchant: "Shop",
          dedupeHash: "1",
        },
        {
          accountId: a.id,
          date: "2026-05-01",
          amountCents: -9000,
          rawDescription: "XFER",
          merchant: "Shop",
          dedupeHash: "2",
          isTransfer: true,
        },
        {
          accountId: a.id,
          date: "2026-06-01",
          amountCents: 9000,
          rawDescription: "Refund Shop",
          merchant: "Shop",
          dedupeHash: "3",
        },
      ])
      .run();
    expect(findRefundCandidates(db)).toBe(0);
    db.insert(transactions)
      .values({
        accountId: a.id,
        date: "2026-04-15",
        amountCents: -9000,
        rawDescription: "SHOP",
        merchant: "Shop",
        dedupeHash: "4",
      })
      .run();
    expect(findRefundCandidates(db)).toBe(1);
    const refund = mustFind(
      db.select().from(transactions).all(),
      (r) => r.dedupeHash === "3",
    );
    const original = mustFind(
      db.select().from(transactions).all(),
      (r) => r.dedupeHash === "4",
    );
    expect(refund.suspectedRefundOf).toBe(original.id);
  });
});
