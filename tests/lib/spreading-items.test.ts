import { describe, expect, it } from "vitest";
import type { Bill } from "@/lib/recurring/refresh";
import { irregularItems, spreadByLeaf } from "@/lib/spreading/items";
import type { PlannedExpense } from "@/lib/spreading/types";

const bill = (p: Partial<Bill>): Bill => ({
  id: 1,
  merchant: "Insurer",
  categoryId: 5,
  categoryName: "Insurance",
  color: "#FF9500",
  cadence: "quarterly",
  intervalDays: 90,
  avgCents: -30000,
  monthlyCents: 10000,
  occurrences: 3,
  firstSeen: "2026-01-10",
  lastSeen: "2026-07-10",
  nextExpected: "2026-10-10",
  dueInDays: 34,
  isNew: false,
  active: true,
  dismissed: false,
  recentAmounts: [],
  confidence: "confirmed",
  manual: false,
  isIncome: false,
  ...p,
});

const planned = (p: Partial<PlannedExpense>): PlannedExpense => ({
  id: 1,
  name: "Car registration",
  amountCents: 120000,
  dueDate: "2027-03-15",
  every: "year",
  categoryId: 8,
  createdAt: "2025-09-01",
  archived: false,
  ...p,
});

const leaves = [
  { id: 5, name: "Insurance", color: "#FF9500" },
  { id: 8, name: "Registrations", color: "#5856D6" },
];

describe("irregularItems", () => {
  it("builds one item per quarterly/annual bill and per planned expense, with shares and accruals", () => {
    const items = irregularItems({
      bills: [bill({})],
      planned: [planned({})],
      today: "2026-09-06",
      leaves,
    });
    expect(items).toHaveLength(2);
    // Sorted by nextDue: the bill (2026-10-10) before the planned item (2027-03-15).
    expect(items.map((it) => it.key)).toEqual(["bill:1", "planned:1"]);

    const billItem = items[0];
    expect(billItem).toMatchObject({
      source: "bill",
      name: "Insurer",
      amountCents: 30000,
      every: "quarter",
      nextDue: "2026-10-10",
      periodMonths: 3,
      monthlyCents: 10000,
      categoryId: 5,
      categoryName: "Insurance",
    });
    // previousDue = 2026-10-10 shifted back 3 months = 2026-07-10; today
    // 2026-09-06 is 2 calendar months later but day 6 < day 10, so only 1
    // whole month has elapsed: 1 * 10000 = 10000.
    expect(billItem.accruedCents).toBe(10000);

    const plannedItem = items[1];
    expect(plannedItem).toMatchObject({
      source: "planned",
      name: "Car registration",
      amountCents: 120000,
      every: "year",
      nextDue: "2027-03-15",
      periodMonths: 12,
      monthlyCents: 10000,
      categoryId: 8,
      categoryName: "Registrations",
    });
    // previousDue = 2027-03-15 shifted back 12 months = 2026-03-15; today
    // 2026-09-06 is 6 calendar months later but day 6 < day 15, so 5 whole
    // months have elapsed: 5 * 10000 = 50000.
    expect(plannedItem.accruedCents).toBe(50000);
    expect(plannedItem.planned).toEqual(planned({}));
  });

  it("excludes income, dismissed, inactive and non-quarterly/annual bills", () => {
    const items = irregularItems({
      bills: [
        bill({ id: 2, isIncome: true }),
        bill({ id: 3, dismissed: true }),
        bill({ id: 4, active: false }),
        bill({ id: 5, cadence: "monthly" }),
      ],
      planned: [],
      today: "2026-09-06",
      leaves,
    });
    expect(items).toHaveLength(0);
  });

  it("excludes archived planned expenses", () => {
    const items = irregularItems({
      bills: [],
      planned: [planned({ archived: true })],
      today: "2026-09-06",
      leaves,
    });
    expect(items).toHaveLength(0);
  });

  it("accrues nothing before the item existed, then one share per elapsed month", () => {
    const items = irregularItems({
      bills: [],
      planned: [
        planned({
          name: "Annual",
          every: "year",
          dueDate: "2027-01-15",
          createdAt: "2026-09-06",
          amountCents: 120000,
        }),
      ],
      today: "2026-09-06",
      leaves,
    });
    // previousDue (2027-01-15 shifted back 12mo = 2026-01-15) is before the
    // item's creation date, so it's clamped forward to 2026-09-06: nothing
    // has accrued yet on the day the item was created.
    expect(items[0].accruedCents).toBe(0);

    const nextMonth = irregularItems({
      bills: [],
      planned: [
        planned({
          name: "Annual",
          every: "year",
          dueDate: "2027-01-15",
          createdAt: "2026-09-06",
          amountCents: 120000,
        }),
      ],
      today: "2026-10-06",
      leaves,
    });
    expect(nextMonth[0].accruedCents).toBe(10000);
  });

  it("accrues nothing for a once expense until a full month has passed since creation", () => {
    const items = irregularItems({
      bills: [],
      planned: [
        planned({
          name: "Trip",
          every: "once",
          dueDate: "2026-12-01",
          createdAt: "2026-09-30T22:00:00.000Z",
          amountCents: 60000,
        }),
      ],
      today: "2026-10-01",
      leaves,
    });
    expect(items[0].accruedCents).toBe(0);
  });

  it("returns null nextDue for a once expense whose due date has passed, sorted last", () => {
    const items = irregularItems({
      bills: [bill({})],
      planned: [
        planned({
          id: 2,
          name: "Past trip",
          every: "once",
          dueDate: "2026-01-01",
          createdAt: "2025-10-01",
        }),
      ],
      today: "2026-09-06",
      leaves,
    });
    expect(items.map((it) => it.key)).toEqual(["bill:1", "planned:2"]);
    expect(items[1].nextDue).toBeNull();
  });
});

describe("spreadByLeaf", () => {
  it("sums monthly shares per category and collects names", () => {
    const items = irregularItems({
      bills: [bill({})],
      planned: [planned({}), planned({ id: 2, name: "Trip", categoryId: 5 })],
      today: "2026-09-06",
      leaves,
    });
    const all = spreadByLeaf(items);
    expect(all.get(5)).toEqual({ cents: 20000, names: ["Insurer", "Trip"] });
    expect(all.get(8)).toEqual({ cents: 10000, names: ["Car registration"] });

    const plannedOnly = spreadByLeaf(items, { source: "planned" });
    expect(plannedOnly.get(5)).toEqual({ cents: 10000, names: ["Trip"] });
    expect(plannedOnly.get(8)).toEqual({
      cents: 10000,
      names: ["Car registration"],
    });
  });

  it("skips items with no category", () => {
    const items = irregularItems({
      bills: [bill({ categoryId: null, categoryName: null })],
      planned: [],
      today: "2026-09-06",
      leaves,
    });
    expect(spreadByLeaf(items).size).toBe(0);
  });
});
