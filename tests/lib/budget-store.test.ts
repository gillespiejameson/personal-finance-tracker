import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  budgetMonths,
  copyBudgetMonth,
  getBudgetIncome,
  listBudgetLeaves,
  listBudgetRows,
  saveBudgetMonth,
  setBudgetIncome,
  setBudgetRow,
  validBudgetRows,
} from "@/lib/budget/store";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { setCategoryRollover } from "@/lib/categories/manage";
import { openDb } from "@/lib/db/client";
import { categories, goals } from "@/lib/db/schema";

function seed() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  return db;
}

describe("listBudgetLeaves", () => {
  it("returns only leaves of expense parents, excludes archived, joins goals", () => {
    const db = seed();
    const paycheck = findCategoryId(db, "Paycheck") as number;
    const groceries = findCategoryId(db, "Groceries") as number;
    const savings = findCategoryId(db, "Savings & investing") as number;
    const rentMortgage = findCategoryId(db, "Rent/Mortgage") as number;
    // Archive a leaf; it must drop out.
    const generalId = findCategoryId(db, "General") as number;
    db.update(categories)
      .set({ archived: true })
      .where(eq(categories.id, generalId))
      .run();
    const [goal] = db
      .insert(goals)
      .values({ name: "Trip", targetCents: 100000, categoryId: savings })
      .returning()
      .all();

    const leaves = listBudgetLeaves(db);

    expect(leaves.some((l) => l.id === paycheck)).toBe(false); // income parent
    expect(leaves.some((l) => l.name === "Transfer")).toBe(false);
    expect(leaves.some((l) => l.name === "Uncategorized")).toBe(false);
    expect(leaves.some((l) => l.id === generalId)).toBe(false); // archived

    const groc = leaves.find((l) => l.id === groceries);
    expect(groc).toBeDefined();
    expect(groc?.isSavings).toBe(false);

    const sav = leaves.find((l) => l.id === savings);
    expect(sav?.isSavings).toBe(true);
    expect(sav?.goalId).toBe(goal.id);

    const rent = leaves.find((l) => l.id === rentMortgage);
    const homeParentId = db
      .select({ sort: categories.sort })
      .from(categories)
      .where(eq(categories.id, rent?.parentId as number))
      .get()?.sort;
    expect(rent?.parentSort).toBe(homeParentId); // matches the parent's own sort

    // Ordered by parent sort, then leaf sort.
    const homeLeaves = leaves.filter((l) => l.parentName === "Home");
    expect(homeLeaves.map((l) => l.name)).toEqual([
      "Rent/Mortgage",
      "Utilities",
      "Insurance",
      "Repairs & household",
    ]);
    const idx = (name: string) => leaves.findIndex((l) => l.name === name);
    expect(idx("Rent/Mortgage")).toBeLessThan(idx("Groceries"));
  });

  it("marks a goal archived and excludes it from goalId", () => {
    const db = seed();
    const savings = findCategoryId(db, "Savings & investing") as number;
    db.insert(goals)
      .values({
        name: "Old",
        targetCents: 1,
        categoryId: savings,
        archived: true,
      })
      .run();
    const leaves = listBudgetLeaves(db);
    const sav = leaves.find((l) => l.id === savings);
    expect(sav?.goalId).toBeNull();
  });
});

describe("budget rows and income", () => {
  it("saveBudgetMonth replaces rows, drops zero amounts, sets income", () => {
    const db = seed();
    const groceries = findCategoryId(db, "Groceries") as number;
    const rent = findCategoryId(db, "Rent/Mortgage") as number;
    saveBudgetMonth(
      db,
      "2026-09",
      [
        { categoryId: groceries, amountCents: 40000 },
        { categoryId: rent, amountCents: 0 },
      ],
      300000,
    );
    let rows = listBudgetRows(db, { month: "2026-09" });
    expect(rows).toEqual([
      { month: "2026-09", categoryId: groceries, amountCents: 40000 },
    ]);
    expect(getBudgetIncome(db, "2026-09")).toBe(300000);

    // Replacing the month drops the old row set entirely.
    saveBudgetMonth(
      db,
      "2026-09",
      [{ categoryId: rent, amountCents: 150000 }],
      310000,
    );
    rows = listBudgetRows(db, { month: "2026-09" });
    expect(rows).toEqual([
      { month: "2026-09", categoryId: rent, amountCents: 150000 },
    ]);
    expect(getBudgetIncome(db, "2026-09")).toBe(310000);
  });

  it("getBudgetIncome is null for a month with no income set", () => {
    const db = seed();
    expect(getBudgetIncome(db, "2026-09")).toBeNull();
    setBudgetIncome(db, "2026-09", 250000);
    expect(getBudgetIncome(db, "2026-09")).toBe(250000);
  });

  it("setBudgetRow upserts and deletes on 0", () => {
    const db = seed();
    const groceries = findCategoryId(db, "Groceries") as number;
    setBudgetRow(db, "2026-09", groceries, 40000);
    expect(listBudgetRows(db, { month: "2026-09" })).toEqual([
      { month: "2026-09", categoryId: groceries, amountCents: 40000 },
    ]);
    setBudgetRow(db, "2026-09", groceries, 45000);
    expect(listBudgetRows(db, { month: "2026-09" })).toEqual([
      { month: "2026-09", categoryId: groceries, amountCents: 45000 },
    ]);
    setBudgetRow(db, "2026-09", groceries, 0);
    expect(listBudgetRows(db, { month: "2026-09" })).toEqual([]);
  });

  it("copyBudgetMonth copies rows and income, refuses when target has rows", () => {
    const db = seed();
    const groceries = findCategoryId(db, "Groceries") as number;
    const rent = findCategoryId(db, "Rent/Mortgage") as number;
    saveBudgetMonth(
      db,
      "2026-08",
      [
        { categoryId: groceries, amountCents: 40000 },
        { categoryId: rent, amountCents: 150000 },
      ],
      300000,
    );
    const result = copyBudgetMonth(db, "2026-08", "2026-09");
    expect(result).toEqual({ ok: true, copied: 2 });
    expect(listBudgetRows(db, { month: "2026-09" })).toEqual(
      expect.arrayContaining([
        { month: "2026-09", categoryId: groceries, amountCents: 40000 },
        { month: "2026-09", categoryId: rent, amountCents: 150000 },
      ]),
    );
    expect(getBudgetIncome(db, "2026-09")).toBe(300000);

    // Target already has rows: refuse without touching anything.
    setBudgetRow(db, "2026-10", groceries, 1000);
    const refused = copyBudgetMonth(db, "2026-08", "2026-10");
    expect(refused).toEqual({
      ok: false,
      error: "That month already has a budget.",
    });
    expect(listBudgetRows(db, { month: "2026-10" })).toEqual([
      { month: "2026-10", categoryId: groceries, amountCents: 1000 },
    ]);

    // Source has nothing to copy: refuse.
    const nothingToCopy = copyBudgetMonth(db, "2026-11", "2026-12");
    expect(nothingToCopy).toEqual({ ok: false, error: "Nothing to copy." });
  });

  it("budgetMonths returns sorted unique months", () => {
    const db = seed();
    const groceries = findCategoryId(db, "Groceries") as number;
    saveBudgetMonth(
      db,
      "2026-09",
      [{ categoryId: groceries, amountCents: 1 }],
      0,
    );
    saveBudgetMonth(
      db,
      "2026-07",
      [{ categoryId: groceries, amountCents: 1 }],
      0,
    );
    saveBudgetMonth(
      db,
      "2026-08",
      [{ categoryId: groceries, amountCents: 1 }],
      0,
    );
    expect(budgetMonths(db)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });
});

describe("validBudgetRows", () => {
  it("accepts rows whose categoryId is a budgetable leaf", () => {
    const db = seed();
    const groceries = findCategoryId(db, "Groceries") as number;
    const rent = findCategoryId(db, "Rent/Mortgage") as number;
    expect(
      validBudgetRows(db, [
        { categoryId: groceries, amountCents: 40000 },
        { categoryId: rent, amountCents: 150000 },
      ]),
    ).toBe(true);
  });

  it("rejects a parent category id, an income leaf, or an unknown id", () => {
    const db = seed();
    const food = findCategoryId(db, "Food") as number;
    const paycheck = findCategoryId(db, "Paycheck") as number;
    expect(validBudgetRows(db, [{ categoryId: food, amountCents: 1 }])).toBe(
      false,
    );
    expect(
      validBudgetRows(db, [{ categoryId: paycheck, amountCents: 1 }]),
    ).toBe(false);
    expect(validBudgetRows(db, [{ categoryId: 999999, amountCents: 1 }])).toBe(
      false,
    );
  });

  it("is vacuously true for an empty row list", () => {
    const db = seed();
    expect(validBudgetRows(db, [])).toBe(true);
  });
});

describe("setCategoryRollover", () => {
  it("flips the flag on a leaf", () => {
    const db = seed();
    const groceries = findCategoryId(db, "Groceries") as number;
    expect(setCategoryRollover(db, groceries, true)).toEqual({ ok: true });
    expect(
      db.select().from(categories).where(eq(categories.id, groceries)).get()
        ?.rollover,
    ).toBe(true);
    expect(setCategoryRollover(db, groceries, false)).toEqual({ ok: true });
    expect(
      db.select().from(categories).where(eq(categories.id, groceries)).get()
        ?.rollover,
    ).toBe(false);
  });

  it("refuses a parent id", () => {
    const db = seed();
    const food = findCategoryId(db, "Food") as number;
    expect(setCategoryRollover(db, food, true)).toMatchObject({ ok: false });
  });
});
