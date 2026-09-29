import { describe, expect, it } from "vitest";
import { buildBudgetPage } from "@/lib/budget/page";
import type { BudgetRow, LeafMeta } from "@/lib/budget/types";
import type { Line } from "@/lib/insights/lines";
import type { Bill } from "@/lib/recurring/refresh";
import type { IrregularItem } from "@/lib/spreading/types";

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
): Line => ({
  txnId,
  date,
  month: date.slice(0, 7),
  amountCents,
  merchant: "x",
  accountId: 1,
  categoryId: leaf?.id ?? null,
  leafName: leaf?.name ?? "Uncategorized",
  leafSeedKey: null,
  isFixed: leaf?.isFixed ?? false,
  parentId: leaf?.parentId ?? null,
  parentName: leaf?.parentName ?? "Uncategorized",
  parentKind: leaf ? "expense" : "system",
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

const rows: BudgetRow[] = [
  { month: "2026-08", categoryId: 1, amountCents: 60000 },
  { month: "2026-09", categoryId: 1, amountCents: 60000 },
  { month: "2026-09", categoryId: 2, amountCents: 150000 },
  { month: "2026-09", categoryId: 3, amountCents: 20000 },
];
const lines = [
  line(G, "2026-08-10", -50000, 1), // August: groceries 500 of 600 → carry 100 into September
  line(G, "2026-09-02", -30000, 2),
  line(G, "2026-09-03", 2000, 3), // refund reduces spend → 280
  line(R, "2026-09-01", -150000, 4),
  line(S, "2026-09-05", -20000, 5),
  line(F, "2026-09-04", -4500, 6), // unbudgeted spend
  line(null, "2026-09-04", -1200, 7), // uncategorized
];
const base = {
  lines,
  leaves: [G, R, S, F],
  rows,
  incomeCents: 300000,
  bills: [
    bill({}),
    bill({ id: 10, categoryId: 2, nextExpected: "2026-09-09" }),
  ],
  spread: new Map(),
  setAside: [],
  month: "2026-09",
  today: "2026-09-06",
  gate: { open: true, completeMonths: 3, needed: 2 },
  dataMonths: ["2026-07", "2026-08", "2026-09"],
};

describe("buildBudgetPage", () => {
  it("assembles rows, carry, statuses, strip and safe to spend", () => {
    const p = buildBudgetPage({
      ...base,
      payday: {
        config: { schedule: "weekly", anchor: "2026-09-11" },
        inferred: true,
        next: "2026-09-11",
        daysUntil: 5,
      },
    });
    expect(p.hasBudget).toBe(true);
    expect(p.prevHasBudget).toBe(true);
    expect(p.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(p.assignedCents).toBe(230000);
    expect(p.leftToAssignCents).toBe(70000);
    const groc = p.groups.flatMap((g) => g.leaves).find((l) => l.id === 1);
    expect(groc).toMatchObject({
      budgeted: 60000,
      carry: 10000,
      available: 70000,
      spent: 28000,
      remaining: 42000,
      status: "ok",
    });
    expect(p.groups.map((g) => g.parentName)).toEqual([
      "Home",
      "Food",
      "Savings & Investing",
    ]); // parentSort order; Fun is unbudgeted
    expect(p.unbudgeted.map((l) => l.id)).toEqual([4]);
    expect(p.unbudgeted[0]).toMatchObject({
      spent: 4500,
      budgeted: 0,
      hasRow: false,
    });
    expect(p.uncategorizedCents).toBe(1200);
    expect(p.spentCents).toBe(28000 + 150000 + 4500); // categorized non-savings leaves (budgeted + unbudgeted); + uncategorized 1200 = Insights spent
    expect(p.strip).toMatchObject({
      needs: 150000,
      wants: 60000,
      save: 20000,
      needsPct: 0.5,
      wantsPct: 0.2,
    });
    // safe to spend: variable remaining 42000; the gym bill (variable leaf, due 09-10 < 09-11) counts, the rent bill (fixed leaf) does not
    expect(p.safeToSpend).toMatchObject({
      variableRemainingCents: 42000,
      unpostedBillsCents: 4000,
      totalCents: 38000,
      perDayCents: 7600,
      daysUntil: 5,
      horizonKind: "payday",
    });
  });
  it("pins overspent leaves and warns near the limit", () => {
    const p = buildBudgetPage({
      ...base,
      lines: [...lines, line(G, "2026-09-05", -50000, 8)],
      payday: null,
    });
    expect(p.overspent.map((l) => l.id)).toEqual([1]);
    expect(p.overspent[0]).toMatchObject({ status: "over", fill: 1 });
    // The over leaf stays in its parent group so the group's subtotal and
    // presence stay honest — it's only pinned in the `overspent` summary too.
    const food = p.groups.find((g) => g.parentName === "Food");
    expect(food).toBeDefined();
    expect(food?.leaves.map((l) => l.id)).toEqual([1]);
    expect(food).toMatchObject({
      budgeted: 60000,
      spent: 78000,
      remaining: -8000,
    });
    const rent = p.groups.flatMap((g) => g.leaves).find((l) => l.id === 2);
    expect(rent).toMatchObject({ status: "warn", remaining: 0 }); // fully used but not over
  });
  it("counts an overdue unposted bill toward safe to spend", () => {
    const p = buildBudgetPage({
      ...base,
      bills: [
        ...base.bills,
        bill({
          id: 11,
          categoryId: 4,
          nextExpected: "2026-08-30", // before today (2026-09-06): overdue, still unposted
          avgCents: -1500,
          monthlyCents: 1500,
        }),
      ],
      payday: {
        config: { schedule: "weekly", anchor: "2026-09-11" },
        inferred: true,
        next: "2026-09-11",
        daysUntil: 5,
      },
    });
    // 4000 from the gym bill (id 9, due 09-10) plus 1500 from the overdue one.
    expect(p.safeToSpend?.unpostedBillsCents).toBe(5500);
  });
  it("falls back to month end without a payday", () => {
    const p = buildBudgetPage({ ...base, payday: null });
    expect(p.safeToSpend).toMatchObject({
      horizon: "2026-09-30",
      daysUntil: 25,
      horizonKind: "monthEnd",
    });
  });
  it("adds a rest-of-month pace beside the payday figure", () => {
    const p = buildBudgetPage({
      ...base,
      bills: [
        ...base.bills,
        bill({
          id: 11,
          categoryId: 4,
          nextExpected: "2026-09-20", // after payday (09-11), before month end
          avgCents: -1500,
          monthlyCents: 1500,
        }),
      ],
      payday: {
        config: { schedule: "weekly", anchor: "2026-09-11" },
        inferred: true,
        next: "2026-09-11",
        daysUntil: 5,
      },
    });
    // Payday horizon is unchanged: only the gym bill (09-10) is due before 09-11.
    expect(p.safeToSpend).toMatchObject({
      unpostedBillsCents: 4000,
      totalCents: 38000,
      perDayCents: 7600,
    });
    // Month end: today 09-06 through 09-30 is 25 days; gym 4000 + the 09-20 bill 1500;
    // the rent bill (fixed leaf) is still excluded. 42000 − 5500 = 36500; floor(36500 / 25) = 1460.
    expect(p.safeToSpend?.restOfMonth).toEqual({
      horizon: "2026-09-30",
      daysUntil: 25,
      unpostedBillsCents: 5500,
      totalCents: 36500,
      perDayCents: 1460,
    });
  });
  it("has no rest-of-month pace when the card is already on month end", () => {
    const p = buildBudgetPage({ ...base, payday: null });
    expect(p.safeToSpend?.restOfMonth).toBeNull();
  });
  it("reports no budget for an empty month and no safe-to-spend for past months", () => {
    const p = buildBudgetPage({ ...base, month: "2026-07", payday: null });
    expect(p.hasBudget).toBe(false);
    expect(p.isCurrent).toBe(false);
    expect(p.safeToSpend).toBeNull();
  });
  it("puts a leaf's spread entry on setAside, and passes the items through", () => {
    const items: IrregularItem[] = [
      {
        key: "planned:1",
        source: "planned",
        id: 1,
        name: "Car registration",
        amountCents: 20000,
        every: "year",
        nextDue: "2027-03-15",
        periodMonths: 12,
        monthlyCents: 5000,
        accruedCents: 2500,
        categoryId: 1,
        categoryName: "Groceries",
        color: "#FF9500",
      },
    ];
    const p = buildBudgetPage({
      ...base,
      spread: new Map([[1, { cents: 5000, names: ["Car registration"] }]]),
      setAside: items,
      payday: null,
    });
    const groc = p.groups.flatMap((g) => g.leaves).find((l) => l.id === 1);
    expect(groc?.setAside).toEqual({
      cents: 5000,
      names: ["Car registration"],
    });
    const rent = p.groups.flatMap((g) => g.leaves).find((l) => l.id === 2);
    expect(rent?.setAside).toBeNull();
    expect(p.setAside).toBe(items);
  });
});
