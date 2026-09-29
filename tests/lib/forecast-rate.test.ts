import { describe, expect, it } from "vitest";
import type { BudgetGroup, BudgetLeaf, BudgetPage } from "@/lib/budget/types";
import { spendRate } from "@/lib/forecast/rate";

const today = "2026-09-06"; // September has 30 days; 25 days left inclusive of today

function leaf(
  overrides: Partial<BudgetLeaf> &
    Pick<BudgetLeaf, "id" | "name" | "isFixed" | "isSavings">,
): BudgetLeaf {
  return {
    color: "#FF9500",
    parentId: 1,
    parentName: "Everyday",
    rollover: false,
    goalId: null,
    budgeted: 0,
    carry: 0,
    available: 0,
    spent: 0,
    remaining: 0,
    status: "ok",
    fill: 0,
    hasRow: true,
    setAside: null,
    ...overrides,
  };
}

function group(leaves: BudgetLeaf[]): BudgetGroup {
  return {
    parentId: 1,
    parentName: "Everyday",
    color: "#FF9500",
    leaves,
    budgeted: leaves.reduce((s, l) => s + l.budgeted, 0),
    spent: leaves.reduce((s, l) => s + l.spent, 0),
    remaining: leaves.reduce((s, l) => s + l.remaining, 0),
  };
}

function budgetFixture(overrides: Partial<BudgetPage> = {}): BudgetPage {
  return {
    month: "2026-09",
    months: ["2026-09"],
    today,
    isCurrent: true,
    gate: { open: true, completeMonths: 3, needed: 3 },
    hasBudget: true,
    prevHasBudget: true,
    nextHasBudget: false,
    incomeCents: 500000,
    assignedCents: 400000,
    leftToAssignCents: 100000,
    budgetedCents: 400000,
    spentCents: 140000,
    strip: {
      needs: 0,
      wants: 0,
      save: 0,
      needsPct: 0,
      wantsPct: 0,
      savePct: 0,
    },
    groups: [],
    overspent: [],
    unbudgeted: [],
    uncategorizedCents: 0,
    safeToSpend: null,
    payday: null,
    setAside: [],
    ...overrides,
  };
}

describe("spendRate — budget source", () => {
  it("computes this-month and later daily rates from variable (non-fixed, non-savings) leaves", () => {
    const budget = budgetFixture({
      groups: [
        group([
          leaf({
            id: 1,
            name: "Groceries",
            isFixed: false,
            isSavings: false,
            remaining: 12500,
            budgeted: 20000,
          }),
          leaf({
            id: 2,
            name: "Dining out",
            isFixed: false,
            isSavings: false,
            remaining: -3000,
            budgeted: 15000,
          }),
          leaf({
            id: 3,
            name: "Rent",
            isFixed: true,
            isSavings: false,
            remaining: 100000,
            budgeted: 100000,
          }),
          leaf({
            id: 4,
            name: "Emergency fund",
            isFixed: false,
            isSavings: true,
            remaining: 50000,
            budgeted: 50000,
          }),
        ]),
      ],
    });
    const rate = spendRate({
      budget,
      avgVariableCents: null,
      avgUncategorizedCents: null,
      today,
    });
    // variable remaining: 12500 + (-3000) = 9500; max(0, 9500) / 25 days left = 380
    // variable budgeted: 20000 + 15000 = 35000, carried monthly (no uncategorized average)
    expect(rate).toEqual({
      source: "budget",
      thisMonthDailyCents: 380,
      laterMonthlyCents: 35000,
    });
  });

  it("adds the average uncategorized outflow on top of both figures", () => {
    const budget = budgetFixture({
      groups: [
        group([
          leaf({
            id: 1,
            name: "Groceries",
            isFixed: false,
            isSavings: false,
            remaining: 12500,
            budgeted: 20000,
          }),
          leaf({
            id: 2,
            name: "Dining out",
            isFixed: false,
            isSavings: false,
            remaining: -3000,
            budgeted: 15000,
          }),
        ]),
      ],
    });
    const rate = spendRate({
      budget,
      avgVariableCents: null,
      avgUncategorizedCents: 60000,
      today,
    });
    // Same base figures as above (380, 35000), plus 60000 / 30 = 2000/day
    // added to the this-month rate, and the raw 60000 folded into the
    // monthly figure used for later months (so it too works out to +2000/day
    // over a 30-day month).
    expect(rate).toEqual({
      source: "budget",
      thisMonthDailyCents: 2380,
      laterMonthlyCents: 95000,
    });
  });

  it("floors a negative variable-remaining total at zero for this month's rate", () => {
    const budget = budgetFixture({
      groups: [
        group([
          leaf({
            id: 1,
            name: "Groceries",
            isFixed: false,
            isSavings: false,
            remaining: -8000,
            budgeted: 20000,
          }),
        ]),
      ],
    });
    const rate = spendRate({
      budget,
      avgVariableCents: null,
      avgUncategorizedCents: null,
      today,
    });
    // remaining total -8000 -> max(0, -8000) = 0 -> 0 / 25 = 0
    // budgeted 20000, carried as-is (no uncategorized average)
    expect(rate).toEqual({
      source: "budget",
      thisMonthDailyCents: 0,
      laterMonthlyCents: 20000,
    });
  });

  it("adds nothing when there is no uncategorized average", () => {
    const budget = budgetFixture({
      groups: [
        group([
          leaf({
            id: 1,
            name: "Groceries",
            isFixed: false,
            isSavings: false,
            remaining: -8000,
            budgeted: 20000,
          }),
        ]),
      ],
    });
    const rate = spendRate({
      budget,
      avgVariableCents: null,
      avgUncategorizedCents: null,
      today,
    });
    expect(rate).toEqual({
      source: "budget",
      thisMonthDailyCents: 0,
      laterMonthlyCents: 20000,
    });
  });
});

describe("spendRate — fallbacks", () => {
  it("falls back to a 3-month average when there is no open budget", () => {
    const rate = spendRate({
      budget: null,
      avgVariableCents: 45000,
      avgUncategorizedCents: null,
      today,
    });
    // 45000 / 30 = 1500 for this month; the later-month rate carries the
    // raw monthly average (bucketOf already folds uncategorized spend in).
    expect(rate).toEqual({
      source: "average",
      thisMonthDailyCents: 1500,
      laterMonthlyCents: 45000,
    });
  });

  it("treats a budget with a closed gate the same as no budget", () => {
    const budget = budgetFixture({
      gate: { open: false, completeMonths: 1, needed: 3 },
    });
    const rate = spendRate({
      budget,
      avgVariableCents: 30000,
      avgUncategorizedCents: null,
      today,
    });
    expect(rate).toEqual({
      source: "average",
      thisMonthDailyCents: 1000,
      laterMonthlyCents: 30000,
    });
  });

  it("treats a page with hasBudget false the same as no budget", () => {
    const budget = budgetFixture({ hasBudget: false });
    const rate = spendRate({
      budget,
      avgVariableCents: 30000,
      avgUncategorizedCents: null,
      today,
    });
    expect(rate).toEqual({
      source: "average",
      thisMonthDailyCents: 1000,
      laterMonthlyCents: 30000,
    });
  });

  it("returns zero rates when neither a budget nor an average is available", () => {
    expect(
      spendRate({
        budget: null,
        avgVariableCents: null,
        avgUncategorizedCents: null,
        today,
      }),
    ).toEqual({
      source: "none",
      thisMonthDailyCents: 0,
      laterMonthlyCents: 0,
    });
  });
});
