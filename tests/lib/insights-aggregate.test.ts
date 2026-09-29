import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { accounts, transactionSplits, transactions } from "@/lib/db/schema";
import {
  bucketOf,
  categoryBreakdown,
  completeMonths,
  dataMonths,
  monthTotals,
  monthTotalsThrough,
} from "@/lib/insights/aggregate";
import type { Line } from "@/lib/insights/lines";
import { loadLines } from "@/lib/insights/lines";
import { mustFind } from "../helpers";

/** A bare variable-spend line, for the aggregators that take lines directly. */
const line = (
  month: string,
  day: number,
  amountCents: number,
  merchant: string,
): Line => ({
  txnId: day,
  date: `${month}-${String(day).padStart(2, "0")}`,
  month,
  amountCents,
  merchant,
  accountId: 1,
  categoryId: 1,
  leafName: "Groceries",
  leafSeedKey: null,
  isFixed: false,
  parentId: 2,
  parentName: "Food",
  parentSeedKey: null,
  parentKind: "expense",
  color: "#FF9500",
});

function seed() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  const cat = (n: string) => findCategoryId(db, n) as number;
  const [a] = db
    .insert(accounts)
    .values({ name: "Chk", type: "checking" })
    .returning()
    .all();
  const rows = [
    // June: income 4000, rent 1500 (fixed), groceries 300, refund +50 on groceries, savings 200, uncategorized -40, transfer ignored
    {
      date: "2026-06-01",
      amountCents: 400000,
      categoryId: cat("Paycheck"),
      merchant: "Acme Payroll",
    },
    {
      date: "2026-06-02",
      amountCents: -150000,
      categoryId: cat("Rent/Mortgage"),
      merchant: "Realty",
    },
    {
      date: "2026-06-03",
      amountCents: -30000,
      categoryId: cat("Groceries"),
      merchant: "H-E-B",
    },
    {
      date: "2026-06-04",
      amountCents: 5000,
      categoryId: cat("Groceries"),
      merchant: "H-E-B",
    },
    {
      date: "2026-06-05",
      amountCents: -20000,
      categoryId: cat("Savings & investing"),
      merchant: "Acorns",
    },
    {
      date: "2026-06-06",
      amountCents: -4000,
      categoryId: null,
      merchant: "Mystery",
    },
    {
      date: "2026-06-07",
      amountCents: -99900,
      categoryId: null,
      merchant: "Xfer",
      isTransfer: true,
    },
    // July: income 4000, groceries 250, a split Costco 210 = 150 groceries + 60 household, uncategorized +25 (income)
    {
      date: "2026-07-01",
      amountCents: 400000,
      categoryId: cat("Paycheck"),
      merchant: "Acme Payroll",
    },
    {
      date: "2026-07-03",
      amountCents: -25000,
      categoryId: cat("Groceries"),
      merchant: "H-E-B",
    },
    {
      date: "2026-07-04",
      amountCents: -21000,
      categoryId: null,
      merchant: "Costco",
      reviewed: true,
    },
    {
      date: "2026-07-05",
      amountCents: 2500,
      categoryId: null,
      merchant: "Deposit",
    },
  ];
  db.insert(transactions)
    .values(
      rows.map((r, i) => ({
        accountId: a.id,
        rawDescription: r.merchant,
        dedupeHash: `h${i}`,
        isTransfer: false,
        ...r,
      })),
    )
    .run();
  const costco = mustFind(
    db.select().from(transactions).all(),
    (t) => t.merchant === "Costco",
  );
  db.insert(transactionSplits)
    .values([
      {
        transactionId: costco.id,
        categoryId: cat("Groceries"),
        amountCents: -15000,
      },
      {
        transactionId: costco.id,
        categoryId: cat("Repairs & household"),
        amountCents: -6000,
      },
    ])
    .run();
  // pad June and July to ≥ 20 rows each with tiny variable spend so they count as data months
  const pad = [];
  for (let i = 0; i < 20; i++)
    pad.push({
      accountId: a.id,
      date: `2026-06-${String(10 + (i % 15)).padStart(2, "0")}`,
      amountCents: -100,
      rawDescription: "P",
      merchant: "Pad",
      dedupeHash: `pj${i}`,
      categoryId: cat("Coffee & takeout"),
    });
  for (let i = 0; i < 20; i++)
    pad.push({
      accountId: a.id,
      date: `2026-07-${String(10 + (i % 15)).padStart(2, "0")}`,
      amountCents: -100,
      rawDescription: "P",
      merchant: "Pad",
      dedupeHash: `pl${i}`,
      categoryId: cat("Coffee & takeout"),
    });
  db.insert(transactions).values(pad).run();
  return { db, cat };
}

describe("loadLines", () => {
  it("expands split parents, drops transfers, and carries category metadata", () => {
    const { db, cat } = seed();
    const lines = loadLines(db);
    expect(lines.some((l) => l.merchant === "Xfer")).toBe(false);
    const costco = lines.filter((l) => l.merchant === "Costco");
    expect(costco.map((l) => l.amountCents).sort()).toEqual([-15000, -6000]);
    expect(costco.map((l) => l.categoryId).sort()).toEqual(
      [cat("Groceries"), cat("Repairs & household")].sort(),
    );
    const rent = mustFind(lines, (l) => l.merchant === "Realty");
    expect(rent).toMatchObject({
      parentName: "Home",
      leafName: "Rent/Mortgage",
      isFixed: true,
      parentKind: "expense",
      month: "2026-06",
    });
    expect(
      loadLines(db, { from: "2026-07-01" }).every((l) => l.month === "2026-07"),
    ).toBe(true);
  });
});

describe("buckets and month totals", () => {
  it("applies the sign and bucket rules", () => {
    const { db } = seed();
    const lines = loadLines(db);
    expect(bucketOf(mustFind(lines, (l) => l.merchant === "Acorns"))).toBe(
      "savings",
    );
    expect(bucketOf(mustFind(lines, (l) => l.merchant === "Realty"))).toBe(
      "fixed",
    );
    expect(bucketOf(mustFind(lines, (l) => l.merchant === "Mystery"))).toBe(
      "variable",
    );
    expect(bucketOf(mustFind(lines, (l) => l.merchant === "Deposit"))).toBe(
      "income",
    );
    // A goal leaf carries no leaf seed key of its own, but its parent is Savings & Investing.
    expect(
      bucketOf({
        txnId: 1,
        date: "2026-07-01",
        month: "2026-07",
        amountCents: -10000,
        merchant: "Trip fund",
        accountId: 1,
        categoryId: 99,
        leafName: "Trip",
        leafSeedKey: null,
        isFixed: true,
        parentId: 9,
        parentName: "Savings & Investing",
        parentSeedKey: "savings",
        parentKind: "expense",
        color: "#00C7BE",
      }),
    ).toBe("savings");
    const june = monthTotals(lines).get("2026-06");
    expect(june).toEqual({
      income: 400000,
      fixed: 150000,
      variable: 30000 - 5000 + 4000 + 2000,
      savings: 20000,
      spent: 150000 + 25000 + 4000 + 2000,
      leftover: 400000 - 150000 - 31000 - 20000,
    });
    const july = monthTotals(lines).get("2026-07");
    expect(july?.income).toBe(402500);
    // "Repairs & household" inherits fixed from its Home group, so the 6000 split line is fixed spend
    expect(july?.fixed).toBe(6000);
    expect(july?.variable).toBe(25000 + 15000 + 2000);
  });
  it("monthTotalsThrough cuts a month at a day and clamps to the month end", () => {
    const lines = [
      line("2026-08", 3, -1000, "A"),
      line("2026-08", 10, -2000, "A"),
      line("2026-08", 31, -4000, "A"),
    ];
    expect(monthTotalsThrough(lines, "2026-08", 10).variable).toBe(3000);
    expect(monthTotalsThrough(lines, "2026-08", 40).variable).toBe(7000);
    expect(monthTotalsThrough(lines, "2026-08", 10).spent).toBe(3000);
    expect(monthTotalsThrough(lines, "2026-07", 10).variable).toBe(0);
  });
  it("finds data months and complete months", () => {
    const { db } = seed();
    const lines = loadLines(db);
    expect(dataMonths(lines)).toEqual(["2026-06", "2026-07"]);
    expect(
      completeMonths(["2026-06", "2026-07", "2026-08"], "2026-08"),
    ).toEqual(["2026-06", "2026-07"]);
  });
});

describe("categoryBreakdown", () => {
  it("groups by parent with leaves, averages over the given window, and puts Uncategorized last", () => {
    const { db } = seed();
    const lines = loadLines(db);
    const rows = categoryBreakdown(lines, "2026-07", ["2026-06"]);
    const food = mustFind(rows, (r) => r.name === "Food");
    expect(food.thisMonth).toBe(25000 + 15000 + 2000);
    expect(food.lastMonth).toBe(30000 - 5000 + 2000);
    expect(food.avg).toBe(27000);
    expect(food.avgMonths).toBe(1);
    const groceries = mustFind(
      food.leaves ?? [],
      (l) => l.name === "Groceries",
    );
    expect(groceries.thisMonth).toBe(40000);
    expect(rows[rows.length - 1].name).toBe("Uncategorized");
    expect(rows.some((r) => r.name === "Income")).toBe(false);
    expect(rows.some((r) => r.name === "Savings & investing")).toBe(false);
    const total = rows.reduce((s, r) => s + r.thisMonth, 0);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 5);
    // Share base is `spent` (fixed + variable): savings is excluded from the breakdown entirely.
    expect(total).toBe(monthTotals(lines).get("2026-07")?.spent);
    // June has savings too, but the breakdown total still equals `spent` (fixed + variable), not fixed + variable + savings.
    expect(
      categoryBreakdown(lines, "2026-06", []).reduce(
        (s, r) => s + r.thisMonth,
        0,
      ),
    ).toBe(181000);
    expect(monthTotals(lines).get("2026-06")?.spent).toBe(181000);
  });
});
