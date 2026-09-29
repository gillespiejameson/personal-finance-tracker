import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { accounts, transactionSplits, transactions } from "@/lib/db/schema";
import {
  EXPORT_COLUMNS,
  exportFilename,
  exportTransactions,
  transactionsCsv,
} from "@/lib/export/transactions";

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
  const groceries = findCategoryId(db, "Groceries") as number;
  const restaurants = findCategoryId(db, "Restaurants") as number;
  const paycheck = findCategoryId(db, "Paycheck") as number;

  db.insert(transactions)
    .values([
      {
        accountId: chk.id,
        date: "2026-03-05",
        amountCents: -1234,
        rawDescription: "KROGER #123",
        merchant: "Kroger",
        dedupeHash: "e1",
        categoryId: groceries,
        possibleDuplicate: true,
      },
      {
        accountId: chk.id,
        date: "2026-03-04",
        amountCents: -4000,
        rawDescription: "COSTCO",
        merchant: "Costco",
        dedupeHash: "e2",
      },
      {
        accountId: sav.id,
        date: "2026-03-03",
        amountCents: 40000,
        rawDescription: "XFER",
        merchant: "Transfer",
        dedupeHash: "e3",
        isTransfer: true,
      },
      {
        accountId: chk.id,
        date: "2026-03-02",
        amountCents: -500,
        rawDescription: "MISC PURCHASE",
        merchant: "Misc",
        dedupeHash: "e4",
      },
      {
        accountId: chk.id,
        date: "2026-03-01",
        amountCents: 250000,
        rawDescription: "PAYCHECK",
        merchant: "Employer",
        dedupeHash: "e5",
        categoryId: paycheck,
      },
    ])
    .run();
  return { db, chk, sav, groceries, restaurants, paycheck };
}

describe("exportTransactions", () => {
  it("produces the expected columns and values, ordered by date then id descending", () => {
    const { db } = setup();
    const rows = exportTransactions(db);
    expect(EXPORT_COLUMNS).toEqual([
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
    ]);
    expect(rows.map((r) => r[0])).toEqual([
      "2026-03-05",
      "2026-03-04",
      "2026-03-03",
      "2026-03-02",
      "2026-03-01",
    ]);
    expect(rows[0]).toEqual([
      "2026-03-05",
      "Chk",
      "Kroger",
      "KROGER #123",
      "-12.34",
      "Food",
      "Groceries",
      "no",
      "yes",
      "",
    ]);
    expect(rows[2]).toEqual([
      "2026-03-03",
      "Sav",
      "Transfer",
      "XFER",
      "400.00",
      "Uncategorized",
      "",
      "yes",
      "no",
      "",
    ]);
    expect(rows[3]).toEqual([
      "2026-03-02",
      "Chk",
      "Misc",
      "MISC PURCHASE",
      "-5.00",
      "Uncategorized",
      "",
      "no",
      "no",
      "",
    ]);
    expect(rows[4]).toEqual([
      "2026-03-01",
      "Chk",
      "Employer",
      "PAYCHECK",
      "2500.00",
      "Income",
      "Paycheck",
      "no",
      "no",
      "",
    ]);
  });

  it("summarizes split lines into the splits column and leaves the row uncategorized", () => {
    const { db, groceries, restaurants } = setup();
    const [row] = db
      .select({ id: transactions.id, merchant: transactions.merchant })
      .from(transactions)
      .all()
      .filter((r) => r.merchant === "Costco");
    db.insert(transactionSplits)
      .values([
        { transactionId: row.id, categoryId: groceries, amountCents: -3000 },
        { transactionId: row.id, categoryId: restaurants, amountCents: -1000 },
      ])
      .run();
    const rows = exportTransactions(db);
    const costcoRow = rows.find((r) => r[2] === "Costco") as string[];
    expect(costcoRow).toEqual([
      "2026-03-04",
      "Chk",
      "Costco",
      "COSTCO",
      "-40.00",
      "Uncategorized",
      "",
      "no",
      "no",
      "Groceries -30.00; Restaurants -10.00",
    ]);
  });

  it("honors the account filter", () => {
    const { db, sav } = setup();
    const rows = exportTransactions(db, { accountId: sav.id });
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe("Sav");
  });

  it("honors a from/to date range", () => {
    const { db } = setup();
    const rows = exportTransactions(db, {
      from: "2026-03-02",
      to: "2026-03-04",
    });
    expect(rows.map((r) => r[0])).toEqual([
      "2026-03-04",
      "2026-03-03",
      "2026-03-02",
    ]);
  });

  it("honors a category filter", () => {
    const { db, groceries } = setup();
    const rows = exportTransactions(db, { categoryId: groceries });
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe("Kroger");
  });

  it("honors a search filter on merchant/description", () => {
    const { db } = setup();
    const rows = exportTransactions(db, { q: "paycheck" });
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe("Employer");
  });

  it("orders two rows on the same date with the higher id first", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    const inserted = db
      .insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-03-05",
          amountCents: -100,
          rawDescription: "FIRST",
          merchant: "First",
          dedupeHash: "tie1",
        },
        {
          accountId: a.id,
          date: "2026-03-05",
          amountCents: -200,
          rawDescription: "SECOND",
          merchant: "Second",
          dedupeHash: "tie2",
        },
      ])
      .returning()
      .all();
    const higherId = Math.max(...inserted.map((r) => r.id));
    const rows = exportTransactions(db);
    const merchantByHigherId = inserted.find((r) => r.id === higherId)
      ?.merchant as string;
    expect(rows[0][2]).toBe(merchantByHigherId);
  });

  it("guards a merchant starting with a formula-injection character without touching the amount", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    db.insert(transactions)
      .values({
        accountId: a.id,
        date: "2026-03-05",
        amountCents: -500,
        rawDescription: "X",
        merchant: "=cmd|'/c calc'!A1",
        dedupeHash: "inj1",
      })
      .run();
    const [row] = exportTransactions(db);
    expect(row[2]).toBe("'=cmd|'/c calc'!A1");
    expect(row[4]).toBe("-5.00");
  });

  it("returns all matching rows past the on-screen list limit", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      accountId: a.id,
      date: "2026-01-01",
      amountCents: -100,
      rawDescription: "X",
      merchant: "X",
      dedupeHash: `bulk${i}`,
    }));
    db.transaction((tx) => {
      for (let i = 0; i < rows.length; i += 500) {
        tx.insert(transactions)
          .values(rows.slice(i, i + 500))
          .run();
      }
    });
    expect(exportTransactions(db)).toHaveLength(5001);
  });
});

describe("transactionsCsv", () => {
  it("wraps exportTransactions with EXPORT_COLUMNS as the header", () => {
    const { db } = setup();
    const csv = transactionsCsv(db, { accountId: 1 });
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe(EXPORT_COLUMNS.join(","));
    expect(lines).toHaveLength(
      1 + exportTransactions(db, { accountId: 1 }).length,
    );
  });
});

describe("exportFilename", () => {
  it("uses both bounds when present", () => {
    expect(exportFilename({ from: "2026-08-01", to: "2026-08-31" })).toBe(
      "transactions-2026-08-01-2026-08-31.csv",
    );
  });

  it("falls back to transactions-all.csv with no bounds", () => {
    expect(exportFilename({})).toBe("transactions-all.csv");
    expect(exportFilename()).toBe("transactions-all.csv");
  });

  it("uses all for whichever bound is missing", () => {
    expect(exportFilename({ from: "2026-08-01" })).toBe(
      "transactions-2026-08-01-all.csv",
    );
    expect(exportFilename({ to: "2026-08-31" })).toBe(
      "transactions-all-2026-08-31.csv",
    );
  });

  it("names the other filters so two exports never collide", () => {
    expect(
      exportFilename({ from: "2026-01-01", to: "2026-03-31", accountId: 7 }),
    ).toBe("transactions-2026-01-01-2026-03-31-account-7.csv");
    expect(
      exportFilename({ parentId: 3, categoryId: 12, q: "Kroger #12" }),
    ).toBe("transactions-all-group-3-category-12-kroger12.csv");
  });

  it("drops a search term that has no filename-safe characters", () => {
    expect(exportFilename({ q: "***" })).toBe("transactions-all.csv");
  });

  it("truncates a long search term", () => {
    expect(exportFilename({ q: "a".repeat(40) })).toBe(
      `transactions-all-${"a".repeat(24)}.csv`,
    );
  });
});
