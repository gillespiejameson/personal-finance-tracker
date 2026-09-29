import { describe, expect, it } from "vitest";
import { budgetGate } from "@/lib/budget/gate";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";

function seed() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  const [a] = db
    .insert(accounts)
    .values({ name: "Chk", type: "checking" })
    .returning()
    .all();
  return {
    db,
    accountId: a.id,
    categoryId: findCategoryId(db, "Groceries") as number,
  };
}

function fill(
  db: ReturnType<typeof openDb>,
  accountId: number,
  categoryId: number,
  month: string,
  count: number,
  opts: { isTransfer?: boolean } = {},
) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      accountId,
      date: `${month}-${String(1 + (i % 28)).padStart(2, "0")}`,
      amountCents: -1000,
      rawDescription: "P",
      merchant: "P",
      dedupeHash: `${month}-${i}-${opts.isTransfer ? "t" : "n"}`,
      categoryId,
      isTransfer: opts.isTransfer ?? false,
    });
  }
  db.insert(transactions).values(rows).run();
}

describe("budgetGate", () => {
  it("opens when two prior months are dense enough", () => {
    const { db, accountId, categoryId } = seed();
    fill(db, accountId, categoryId, "2026-06", 25);
    fill(db, accountId, categoryId, "2026-07", 25);
    fill(db, accountId, categoryId, "2026-08", 5);
    fill(db, accountId, categoryId, "2026-09", 30);
    expect(budgetGate(db, "2026-09-06")).toEqual({
      open: true,
      completeMonths: 2,
      needed: 2,
    });
  });

  it("stays closed with only one dense prior month", () => {
    const { db, accountId, categoryId } = seed();
    fill(db, accountId, categoryId, "2026-06", 25);
    expect(budgetGate(db, "2026-09-06")).toEqual({
      open: false,
      completeMonths: 1,
      needed: 2,
    });
  });

  it("does not count transfers toward density", () => {
    const { db, accountId, categoryId } = seed();
    fill(db, accountId, categoryId, "2026-06", 25, { isTransfer: true });
    fill(db, accountId, categoryId, "2026-07", 25);
    expect(budgetGate(db, "2026-09-06")).toEqual({
      open: false,
      completeMonths: 1,
      needed: 2,
    });
  });
});
