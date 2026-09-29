import { describe, expect, it } from "vitest";
import type { BudgetLeaf, BudgetPage } from "@/lib/budget/types";
import type { Goal } from "@/lib/goals/types";
import type { Bill } from "@/lib/recurring/refresh";
import { buildWeeklyPage } from "@/lib/ritual/page";
import type { AccountImportRow, ReviewStatus } from "@/lib/ritual/types";

const today = "2026-09-06";

const status: ReviewStatus = {
  doneThisWeek: false,
  lastCompleted: "2026-08-24",
  daysSince: 13,
  due: true,
  streak: 1,
  currentWeekStart: "2026-08-31",
};

const accounts: AccountImportRow[] = [
  {
    id: 1,
    name: "Checking",
    color: "#0A84FF",
    lastImport: "2026-09-01",
    syncedAt: null,
    daysSince: 5,
    staleness: "fresh",
  },
];

function leaf(
  overrides: Partial<BudgetLeaf> &
    Pick<BudgetLeaf, "id" | "name" | "remaining" | "status">,
): BudgetLeaf {
  return {
    color: "#FF9500",
    parentId: 10,
    parentName: "Everyday",
    isFixed: false,
    isSavings: false,
    rollover: false,
    goalId: null,
    budgeted: 10000,
    carry: 0,
    available: 10000,
    spent: 5000,
    fill: 0.5,
    hasRow: true,
    setAside: null,
    ...overrides,
  };
}

const overLeaf = leaf({
  id: 1,
  name: "Dining out",
  remaining: -5000,
  status: "over",
});
const warnLeaf = leaf({
  id: 2,
  name: "Groceries",
  remaining: 1000,
  status: "warn",
});
const okLeaf = leaf({
  id: 3,
  name: "Fun money",
  remaining: 3000,
  status: "ok",
});

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
    groups: [
      {
        parentId: 10,
        parentName: "Everyday",
        color: "#FF9500",
        leaves: [overLeaf, warnLeaf, okLeaf],
        budgeted: 30000,
        spent: 9000,
        remaining: -1000,
      },
    ],
    overspent: [overLeaf],
    unbudgeted: [],
    uncategorizedCents: 2000,
    safeToSpend: null,
    payday: null,
    setAside: [],
    ...overrides,
  };
}

function billFixture(
  overrides: Partial<Bill> &
    Pick<Bill, "id" | "merchant" | "nextExpected" | "dueInDays">,
): Bill {
  return {
    categoryId: null,
    categoryName: null,
    color: null,
    cadence: "monthly",
    intervalDays: 30,
    avgCents: -5000,
    monthlyCents: 5000,
    occurrences: 4,
    firstSeen: "2026-05-01",
    lastSeen: "2026-08-01",
    isNew: false,
    active: true,
    dismissed: false,
    recentAmounts: [],
    confidence: "confirmed",
    manual: false,
    isIncome: false,
    ...overrides,
  };
}

const overdueBill = billFixture({
  id: 1,
  merchant: "Electric Co",
  nextExpected: "2026-09-01",
  dueInDays: -5,
});
const dueSoonBill = billFixture({
  id: 2,
  merchant: "Internet",
  nextExpected: "2026-09-09",
  dueInDays: 3,
});
const dueLaterBill = billFixture({
  id: 3,
  merchant: "Gym",
  nextExpected: "2026-09-26",
  dueInDays: 20,
});
const incomeBill = billFixture({
  id: 4,
  merchant: "Payroll",
  nextExpected: "2026-09-07",
  dueInDays: 1,
  isIncome: true,
  avgCents: 300000,
  monthlyCents: 300000,
});
const dismissedBill = billFixture({
  id: 5,
  merchant: "Old subscription",
  nextExpected: "2026-09-08",
  dueInDays: 2,
  dismissed: true,
});

const bills: Bill[] = [
  overdueBill,
  dueSoonBill,
  dueLaterBill,
  incomeBill,
  dismissedBill,
];

function goalFixture(
  overrides: Partial<Goal> & Pick<Goal, "id" | "name">,
): Goal {
  return {
    targetCents: 500000,
    targetDate: null,
    categoryId: 1,
    startingCents: 0,
    startDate: "2026-01-01",
    archived: false,
    progressCents: 200000,
    pct: 0.4,
    monthsRemaining: null,
    monthlyNeededCents: null,
    reached: false,
    ...overrides,
  };
}

const datedGoal = goalFixture({
  id: 1,
  name: "Emergency fund",
  targetDate: "2026-12-31",
  pct: 0.4,
});
const undatedGoal = goalFixture({ id: 2, name: "New couch" });
const goals: Goal[] = [datedGoal, undatedGoal];

describe("buildWeeklyPage", () => {
  it("assembles pace from the budget when the gate is open and a budget exists", () => {
    const page = buildWeeklyPage({
      today,
      status,
      accounts,
      queueCount: 12,
      budget: budgetFixture(),
      insightsSpent: 140000,
      avgSpend: 120000,
      bills,
      goals,
      alertCount: 3,
    });

    expect(page.pace.reference).toBe("budget");
    expect(page.pace.spentCents).toBe(140000); // budget.spentCents, excludes uncategorized
    expect(page.pace.referenceCents).toBe(400000);
    expect(page.gateOpen).toBe(true);
    expect(page.hasBudget).toBe(true);
    expect(page.budgetLeftToAssign).toBe(100000);
  });

  it("maps overspent and warn leaves to PaceLeaf, sorted by remaining ascending", () => {
    const page = buildWeeklyPage({
      today,
      status,
      accounts,
      queueCount: 0,
      budget: budgetFixture(),
      insightsSpent: 0,
      avgSpend: null,
      bills: [],
      goals: [],
      alertCount: 0,
    });

    expect(page.overspent).toEqual([
      {
        id: 1,
        name: "Dining out",
        parentName: "Everyday",
        color: "#FF9500",
        remaining: -5000,
        status: "over",
      },
    ]);
    expect(page.warn).toEqual([
      {
        id: 2,
        name: "Groceries",
        parentName: "Everyday",
        color: "#FF9500",
        remaining: 1000,
        status: "warn",
      },
    ]);
  });

  it("filters bills to overdue or due within 7 days, excluding income and dismissed, overdue first", () => {
    const page = buildWeeklyPage({
      today,
      status,
      accounts,
      queueCount: 0,
      budget: budgetFixture(),
      insightsSpent: 0,
      avgSpend: null,
      bills,
      goals: [],
      alertCount: 0,
    });

    expect(page.bills.map((b) => b.merchant)).toEqual([
      "Electric Co",
      "Internet",
    ]);
    expect(page.bills[0].overdue).toBe(true);
    expect(page.bills[1].overdue).toBe(false);
  });

  it("reports goal count (non-archived) and the nearest dated goal with its pct", () => {
    const page = buildWeeklyPage({
      today,
      status,
      accounts,
      queueCount: 0,
      budget: budgetFixture(),
      insightsSpent: 0,
      avgSpend: null,
      bills: [],
      goals: [
        ...goals,
        goalFixture({ id: 3, name: "Archived", archived: true }),
      ],
      alertCount: 0,
    });

    expect(page.goals.count).toBe(2);
    expect(page.goals.nearest).toEqual({
      name: "Emergency fund",
      targetDate: "2026-12-31",
      pct: 0.4,
    });
  });

  it("falls back to the three-month average when there is no budget", () => {
    const page = buildWeeklyPage({
      today,
      status,
      accounts,
      queueCount: 0,
      budget: budgetFixture({ hasBudget: false }),
      insightsSpent: 90000,
      avgSpend: 120000,
      bills: [],
      goals: [],
      alertCount: 0,
    });

    expect(page.pace.reference).toBe("average");
    expect(page.pace.spentCents).toBe(90000);
    expect(page.pace.referenceCents).toBe(120000);
    expect(page.hasBudget).toBe(false);
    expect(page.budgetLeftToAssign).toBeNull();
  });

  it("falls back to the average when the gate is closed even with a budget", () => {
    const page = buildWeeklyPage({
      today,
      status,
      accounts,
      queueCount: 0,
      budget: budgetFixture({
        gate: { open: false, completeMonths: 1, needed: 3 },
      }),
      insightsSpent: 90000,
      avgSpend: 120000,
      bills: [],
      goals: [],
      alertCount: 0,
    });

    expect(page.pace.reference).toBe("average");
    expect(page.gateOpen).toBe(false);
  });

  it("uses reference none when there is no budget and no usable average", () => {
    const page = buildWeeklyPage({
      today,
      status,
      accounts,
      queueCount: 0,
      budget: budgetFixture({ hasBudget: false }),
      insightsSpent: 0,
      avgSpend: null,
      bills: [],
      goals: [],
      alertCount: 0,
    });

    expect(page.pace.reference).toBe("none");
  });

  it("also falls back to none when avgSpend is zero", () => {
    const page = buildWeeklyPage({
      today,
      status,
      accounts,
      queueCount: 0,
      budget: budgetFixture({ hasBudget: false }),
      insightsSpent: 0,
      avgSpend: 0,
      bills: [],
      goals: [],
      alertCount: 0,
    });

    expect(page.pace.reference).toBe("none");
  });

  it("passes alertCount through unchanged", () => {
    const page = buildWeeklyPage({
      today,
      status,
      accounts,
      queueCount: 0,
      budget: budgetFixture(),
      insightsSpent: 0,
      avgSpend: null,
      bills: [],
      goals: [],
      alertCount: 4,
    });

    expect(page.alertCount).toBe(4);
  });
});
