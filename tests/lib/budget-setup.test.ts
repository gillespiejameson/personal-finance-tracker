import { describe, expect, it } from "vitest";
import { roundUp10, setupDefaults } from "@/lib/budget/setup";
import type { LeafMeta } from "@/lib/budget/types";
import type { Line } from "@/lib/insights/lines";
import type { Bill } from "@/lib/recurring/refresh";

const G: LeafMeta = {
  id: 1,
  name: "Groceries",
  parentId: 10,
  parentName: "Food",
  parentSeedKey: "food",
  color: "#FF9500",
  isFixed: false,
  isSavings: false,
  rollover: true,
  sort: 1,
  parentSort: 3,
  goalId: null,
};
const R: LeafMeta = {
  id: 2,
  name: "Rent",
  parentId: 11,
  parentName: "Home",
  parentSeedKey: "home",
  color: "#007AFF",
  isFixed: true,
  isSavings: false,
  rollover: false,
  sort: 1,
  parentSort: 1,
  goalId: null,
};
const S: LeafMeta = {
  id: 3,
  name: "Savings",
  parentId: 12,
  parentName: "Savings & Investing",
  parentSeedKey: "savings",
  color: "#00C7BE",
  isFixed: true,
  isSavings: true,
  rollover: false,
  sort: 1,
  parentSort: 9,
  goalId: null,
};
const F: LeafMeta = {
  id: 4,
  name: "Fun",
  parentId: 13,
  parentName: "Fun",
  parentSeedKey: "fun",
  color: "#FFCC00",
  isFixed: false,
  isSavings: false,
  rollover: false,
  sort: 1,
  parentSort: 5,
  goalId: null,
};
const line = (
  leaf: LeafMeta | null,
  date: string,
  amountCents: number,
  txnId: number,
  kind?: "income",
): Line => ({
  txnId,
  date,
  month: date.slice(0, 7),
  amountCents,
  merchant: "x",
  accountId: 1,
  categoryId: kind === "income" ? 99 : (leaf?.id ?? null),
  leafName: leaf?.name ?? (kind === "income" ? "Paycheck" : "Uncategorized"),
  leafSeedKey: null,
  isFixed: leaf?.isFixed ?? false,
  parentId: leaf?.parentId ?? null,
  parentName:
    leaf?.parentName ?? (kind === "income" ? "Income" : "Uncategorized"),
  parentKind: kind === "income" ? "income" : leaf ? "expense" : "system",
  parentSeedKey: leaf?.parentSeedKey ?? null,
  color: leaf?.color ?? "#C7C7CC",
});
const bill = (p: Partial<Bill>): Bill => ({
  id: 9,
  merchant: "Gym",
  categoryId: 4,
  categoryName: "Fun",
  color: "#FFCC00",
  cadence: "monthly",
  intervalDays: 30,
  avgCents: -4000,
  monthlyCents: 4000,
  occurrences: 3,
  firstSeen: "2026-06-10",
  lastSeen: "2026-08-10",
  nextExpected: "2026-09-10",
  dueInDays: 4,
  isNew: false,
  active: true,
  dismissed: false,
  recentAmounts: [],
  confidence: "confirmed",
  manual: false,
  isIncome: false,
  ...p,
});

describe("roundUp10", () => {
  it("rounds up to the next ten dollars", () => {
    expect(roundUp10(0)).toBe(0);
    expect(roundUp10(1)).toBe(1000);
    expect(roundUp10(12345)).toBe(13000);
    expect(roundUp10(20000)).toBe(20000);
  });
});
describe("setupDefaults", () => {
  it("suggests averages for variable leaves and max(avg, bills) for fixed leaves", () => {
    const p = setupDefaults({
      lines: [
        line(G, "2026-07-10", -50000, 1),
        line(G, "2026-08-10", -30000, 2),
        line(R, "2026-07-01", -150000, 3),
        line(R, "2026-08-01", -150000, 4),
      ],
      leaves: [G, R, S, F],
      bills: [bill({ categoryId: 2, avgCents: -155000, monthlyCents: 155000 })],
      planned: new Map(),
      month: "2026-09",
      avgWindow: ["2026-07", "2026-08"],
      goalNeeded: new Map(),
      expectedIncomeFallback: 0,
    });
    expect(p.avgMonths).toBe(2);
    expect(p.rows.find((r) => r.categoryId === 1)).toMatchObject({
      avgCents: 40000,
      lastMonthCents: 30000,
      billsCents: 0,
      suggestedCents: 40000,
      hasHistory: true,
    });
    expect(p.rows.find((r) => r.categoryId === 2)).toMatchObject({
      avgCents: 150000,
      billsCents: 155000,
      suggestedCents: 155000,
    });
    expect(p.rows.find((r) => r.categoryId === 4)).toMatchObject({
      avgCents: 0,
      suggestedCents: 0,
      hasHistory: false,
    });
  });
  it("does not floor a fixed leaf on a likely bill", () => {
    const p = setupDefaults({
      lines: [line(R, "2026-07-01", -20000, 1)],
      leaves: [R],
      bills: [
        bill({
          categoryId: 2,
          avgCents: -155000,
          monthlyCents: 155000,
          confidence: "likely",
          occurrences: 2,
        }),
        bill({
          id: 10,
          categoryId: 2,
          avgCents: -30000,
          monthlyCents: 30000,
          confidence: "manual",
          manual: true,
        }),
      ],
      planned: new Map(),
      month: "2026-09",
      avgWindow: ["2026-07", "2026-08"],
      goalNeeded: new Map(),
      expectedIncomeFallback: 0,
    });
    expect(p.rows.find((r) => r.categoryId === 2)).toMatchObject({
      avgCents: 10000,
      billsCents: 30000,
      suggestedCents: 30000,
    });
  });
  it("uses the goal contribution for goal leaves and averages income", () => {
    const goalLeaf: LeafMeta = { ...S, id: 7, name: "Trip", goalId: 1 };
    const p = setupDefaults({
      lines: [
        line(null, "2026-07-05", 300000, 1, "income"),
        line(null, "2026-08-05", 320000, 2, "income"),
        // Uncategorized deposit: not assumed to be a paycheck, so it must
        // not move incomeCents — it shows up in uncategorizedIncomeCents
        // instead.
        line(null, "2026-07-15", 50000, 3),
      ],
      leaves: [goalLeaf],
      bills: [],
      planned: new Map(),
      month: "2026-09",
      avgWindow: ["2026-07", "2026-08"],
      goalNeeded: new Map([[1, 25000]]),
      expectedIncomeFallback: 0,
    });
    expect(p.rows[0]).toMatchObject({ suggestedCents: 25000, goalId: 1 });
    expect(p.incomeCents).toBe(310000);
    expect(p.uncategorizedIncomeCents).toBe(25000); // 50000 / 2 months
    expect(p.uncategorizedSpendCents).toBe(0);
  });
  it("folds planned expenses' monthly shares into the suggestion for fixed and variable leaves", () => {
    const R2: LeafMeta = { ...R, id: 6, name: "Insurance" };
    const p = setupDefaults({
      lines: [
        line(R, "2026-07-01", -20000, 1), // avg 10000 over the 2-month window
        line(R2, "2026-07-01", -6000, 2), // avg 3000 over the 2-month window
      ],
      leaves: [R, R2, F],
      bills: [],
      planned: new Map([
        [2, { cents: 5000, names: ["Insurance premium"] }],
        [6, { cents: 5000, names: ["Insurance premium"] }],
        [4, { cents: 4000, names: ["Vacation"] }],
      ]),
      month: "2026-09",
      avgWindow: ["2026-07", "2026-08"],
      goalNeeded: new Map(),
      expectedIncomeFallback: 0,
    });
    // Fixed, avg (10000) already covers bills(0) + planned(5000): suggestion
    // stays at the average, rounded up.
    expect(p.rows.find((r) => r.categoryId === 2)).toMatchObject({
      avgCents: 10000,
      billsCents: 0,
      plannedCents: 5000,
      plannedNames: ["Insurance premium"],
      suggestedCents: 10000,
    });
    // Fixed, avg (3000) is below bills(0) + planned(5000): suggestion rises
    // to cover the planned share.
    expect(p.rows.find((r) => r.categoryId === 6)).toMatchObject({
      avgCents: 3000,
      plannedCents: 5000,
      suggestedCents: 5000,
    });
    // Variable, avg 0, planned 4000: suggestion rises to the planned share.
    expect(p.rows.find((r) => r.categoryId === 4)).toMatchObject({
      avgCents: 0,
      plannedCents: 4000,
      plannedNames: ["Vacation"],
      suggestedCents: 4000,
      hasHistory: true,
    });
  });
  it("falls back to the bills' expected income with no complete months", () => {
    const p = setupDefaults({
      lines: [],
      leaves: [G],
      bills: [],
      planned: new Map(),
      month: "2026-09",
      avgWindow: [],
      goalNeeded: new Map(),
      expectedIncomeFallback: 999,
    });
    expect(p.incomeCents).toBe(999);
    expect(p.avgMonths).toBe(0);
  });
});
