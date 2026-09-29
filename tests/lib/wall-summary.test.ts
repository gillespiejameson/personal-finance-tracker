import { describe, expect, it } from "vitest";
import type { Bill } from "@/lib/recurring/refresh";
import type { ReviewStatus } from "@/lib/ritual/types";
import type { IrregularItem } from "@/lib/spreading/types";
import { buildWallSummary } from "@/lib/wall/summary";

const today = "2026-09-10";
const now = new Date("2026-09-10T18:30:00Z");
const review: ReviewStatus = {
  doneThisWeek: false,
  lastCompleted: "2026-08-30",
  daysSince: 11,
  due: true,
  streak: 3,
  currentWeekStart: "2026-09-07",
};
const openGate = { open: true, completeMonths: 3, needed: 2 };
const bill = (
  o: Partial<Bill> &
    Pick<Bill, "id" | "merchant" | "avgCents" | "nextExpected" | "dueInDays">,
): Bill =>
  ({
    categoryId: null,
    categoryName: null,
    color: null,
    cadence: "monthly",
    intervalDays: 30,
    monthlyCents: o.avgCents,
    occurrences: 4,
    firstSeen: "2026-05-01",
    lastSeen: "2026-08-10",
    isNew: false,
    active: true,
    dismissed: false,
    recentAmounts: [o.avgCents],
    isIncome: false,
    confidence: "confirmed",
    manual: false,
    ...o,
  }) as Bill;
const item = (
  o: Partial<IrregularItem> &
    Pick<
      IrregularItem,
      "key" | "source" | "id" | "name" | "amountCents" | "nextDue"
    >,
): IrregularItem =>
  ({
    every: "year",
    periodMonths: 12,
    monthlyCents: 0,
    accruedCents: 0,
    categoryId: null,
    categoryName: null,
    color: null,
    ...o,
  }) as IrregularItem;
const base = {
  today,
  now,
  reviewCount: 12,
  review,
  alertCount: 2,
  budget: {
    month: "2026-09",
    gate: openGate,
    hasBudget: true,
    spentCents: 180000,
    budgetedCents: 400000,
    safeToSpend: {
      totalCents: 42000,
      perDayCents: 6000,
      variableRemainingCents: 50000,
      unpostedBillsCents: 8000,
      horizon: "2026-09-17",
      daysUntil: 7,
      horizonKind: "payday" as const,
      restOfMonth: null,
    },
  },
  bills: [
    bill({
      id: 1,
      merchant: "Power Co",
      avgCents: -12000,
      nextExpected: "2026-09-12",
      dueInDays: 2,
    }),
    bill({
      id: 2,
      merchant: "Water Co",
      avgCents: -4000,
      nextExpected: "2026-09-08",
      dueInDays: -2,
    }),
    bill({
      id: 3,
      merchant: "Gym",
      avgCents: -3000,
      nextExpected: "2026-09-25",
      dueInDays: 15,
    }),
    bill({
      id: 4,
      merchant: "Payroll",
      avgCents: 250000,
      nextExpected: "2026-09-11",
      dueInDays: 1,
      isIncome: true,
    }),
    bill({
      id: 5,
      merchant: "Old",
      avgCents: -900,
      nextExpected: "2026-09-11",
      dueInDays: 1,
      dismissed: true,
    }),
  ],
  items: [
    item({
      key: "bill:1",
      source: "bill",
      id: 1,
      name: "Power Co",
      amountCents: 12000,
      nextDue: "2026-09-12",
    }),
    item({
      key: "planned:7",
      source: "planned",
      id: 7,
      name: "Car insurance",
      amountCents: 90000,
      nextDue: "2026-11-01",
    }),
    item({
      key: "planned:8",
      source: "planned",
      id: 8,
      name: "Vet",
      amountCents: 20000,
      nextDue: "2026-10-03",
    }),
    item({
      key: "planned:9",
      source: "planned",
      id: 9,
      name: "Unscheduled",
      amountCents: 100,
      nextDue: null,
    }),
  ],
};

describe("buildWallSummary", () => {
  it("assembles the panel from the app's own numbers", () => {
    const s = buildWallSummary(base);
    expect(s.generatedAt).toBe("2026-09-10T18:30:00.000Z");
    expect(s.today).toBe(today);
    expect(s.gateOpen).toBe(true);
    expect(s.safeToSpend).toEqual({
      perDayCents: 6000,
      totalCents: 42000,
      untilDate: "2026-09-17",
      horizonLabel: "until payday",
    });
    expect(s.bills.due.map((b) => b.name)).toEqual(["Water Co", "Power Co"]); // overdue first; income, dismissed and >7 days excluded
    expect(s.bills.due[0]).toEqual({
      name: "Water Co",
      cents: -4000,
      expectedDate: "2026-09-08",
      overdue: true,
      categoryColor: null,
    });
    expect(s.bills.dueTotalCents).toBe(16000);
    expect(s.review).toEqual({ count: 12, streakWeeks: 3, weeklyDue: true });
    expect(s.budget).toEqual({
      month: "2026-09",
      spentCents: 180000,
      budgetedCents: 400000,
      elapsedShare: 10 / 30,
    });
    expect(s.nextPlanned).toEqual({
      name: "Vet",
      cents: 20000,
      date: "2026-10-03",
    });
    expect(s.alerts).toEqual({ count: 2 });
  });
  it("labels a month-end horizon", () => {
    const s = buildWallSummary({
      ...base,
      budget: {
        ...base.budget,
        safeToSpend: {
          ...base.budget.safeToSpend,
          horizon: "2026-09-30",
          daysUntil: 20,
          horizonKind: "monthEnd",
        },
      },
    });
    expect(s.safeToSpend?.horizonLabel).toBe("until month end");
    expect(s.safeToSpend?.untilDate).toBe("2026-09-30");
  });
  it("nulls budget and safe to spend while the gate is closed or nothing is budgeted", () => {
    const closed = buildWallSummary({
      ...base,
      budget: {
        ...base.budget,
        gate: { open: false, completeMonths: 1, needed: 2 },
        safeToSpend: null,
      },
    });
    expect(closed.gateOpen).toBe(false);
    expect(closed.budget).toBeNull();
    expect(closed.safeToSpend).toBeNull();
    const empty = buildWallSummary({
      ...base,
      budget: { ...base.budget, hasBudget: false, safeToSpend: null },
    });
    expect(empty.gateOpen).toBe(true); // the gate is open; this month simply has no budget
    expect(empty.budget).toBeNull();
  });
  it("handles nothing due and nothing planned", () => {
    const s = buildWallSummary({ ...base, bills: [], items: [] });
    expect(s.bills).toEqual({ due: [], dueTotalCents: 0 });
    expect(s.nextPlanned).toBeNull();
  });
  it("clamps elapsedShare on the last day of the month", () => {
    const s = buildWallSummary({ ...base, today: "2026-09-30" });
    expect(s.budget?.elapsedShare).toBe(1);
  });
});
