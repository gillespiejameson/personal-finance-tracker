import { describe, expect, it } from "vitest";
import { forecastEvents, occurrences } from "@/lib/forecast/events";
import type { Cadence } from "@/lib/recurring/detect";
import type { Bill } from "@/lib/recurring/refresh";
import type { IrregularItem } from "@/lib/spreading/types";

const today = "2026-09-06";

function bill(
  overrides: Partial<Bill> & Pick<Bill, "id" | "merchant" | "nextExpected">,
): Bill {
  return {
    categoryId: null,
    categoryName: null,
    color: null,
    cadence: "weekly",
    intervalDays: 7,
    avgCents: -4500,
    monthlyCents: 19500,
    occurrences: 8,
    firstSeen: "2026-06-01",
    lastSeen: "2026-08-30",
    dueInDays: 5,
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

function planned(
  overrides: Partial<IrregularItem> &
    Pick<IrregularItem, "key" | "id" | "name">,
): IrregularItem {
  return {
    source: "planned",
    amountCents: 30000,
    every: "quarter",
    nextDue: null,
    periodMonths: 3,
    monthlyCents: 10000,
    accruedCents: 0,
    categoryId: null,
    categoryName: null,
    color: null,
    ...overrides,
  };
}

describe("occurrences", () => {
  it("steps weekly from an anchor, keeping only dates inside (from, to]", () => {
    // from 09-06, +30 days -> to 10-06. 09-11/09-18/09-25/10-02 all land in
    // (09-06, 10-06]; the next step, 10-09, would exceed `to` and is dropped.
    expect(occurrences("2026-09-11", "weekly", today, "2026-10-06")).toEqual([
      "2026-09-11",
      "2026-09-18",
      "2026-09-25",
      "2026-10-02",
    ]);
  });

  it("steps monthly from the start's own month, clamping day-of-month without compounding drift", () => {
    // Aug 31 + 1 month -> September has 30 days, clamps to 09-30.
    // Aug 31 + 2 months -> October has 31 days, so it recovers day 31
    // (computed from Aug's month + 2, not from the already-clamped 09-30).
    expect(occurrences("2026-08-31", "monthly", today, "2026-11-05")).toEqual([
      "2026-09-30",
      "2026-10-31",
    ]);
  });

  it("returns nothing when the whole cadence lies outside the window", () => {
    expect(occurrences("2026-12-01", "monthly", today, "2026-10-06")).toEqual(
      [],
    );
  });

  it("throws on an unrecognized cadence instead of looping forever", () => {
    // A bogus cadence would otherwise step by zero days/months, so the
    // candidate date would never advance past `to` and the while loop
    // would spin forever.
    expect(() =>
      occurrences("2026-09-01", "yearly" as Cadence, today, "2026-12-01"),
    ).toThrow();
  });
});

describe("forecastEvents — recurring bills", () => {
  it("places an overdue bill's catch-up occurrence the day after today, then keeps stepping from its original anchor", () => {
    // nextExpected 09-01 is before today (09-06), so it is overdue: a single
    // catch-up occurrence lands on today+1 = 09-07. Later occurrences are
    // NOT re-anchored to 09-07 — they keep stepping weekly from the original
    // 09-01 anchor (09-08, 09-15, ...), filtered to dates after 09-07.
    // days: 10 -> to = 09-16, so 09-22 (09-01 + 3 weeks) falls outside.
    const gym = bill({
      id: 1,
      merchant: "Gym",
      nextExpected: "2026-09-01",
      cadence: "weekly",
      avgCents: -4500,
    });
    expect(
      forecastEvents({ bills: [gym], planned: [], today, days: 10 }),
    ).toEqual([
      { date: "2026-09-07", name: "Gym", amountCents: -4500, kind: "bill" },
      { date: "2026-09-08", name: "Gym", amountCents: -4500, kind: "bill" },
      { date: "2026-09-15", name: "Gym", amountCents: -4500, kind: "bill" },
    ]);
  });

  it("keeps a monthly overdue bill recurring on its original day-of-month instead of drifting onto the catch-up date", () => {
    // nextExpected 08-25 is overdue as of today (09-06): catch-up lands on
    // 09-07, but later occurrences keep stepping monthly from the original
    // 25th anchor — 09-25, 10-25 — rather than from 09-07.
    const rent = bill({
      id: 1,
      merchant: "Rent",
      nextExpected: "2026-08-25",
      cadence: "monthly",
      avgCents: -180000,
    });
    expect(
      forecastEvents({ bills: [rent], planned: [], today, days: 60 }),
    ).toEqual([
      { date: "2026-09-07", name: "Rent", amountCents: -180000, kind: "bill" },
      { date: "2026-09-25", name: "Rent", amountCents: -180000, kind: "bill" },
      { date: "2026-10-25", name: "Rent", amountCents: -180000, kind: "bill" },
    ]);
  });

  it("treats a bill due today the same as overdue: a catch-up on today+1, then the original anchor", () => {
    // nextExpected === today (09-06): catch-up lands on 09-07. The next
    // weekly occurrence steps from the original 09-06 anchor: 09-06 + 7 = 09-13.
    const gym = bill({
      id: 1,
      merchant: "Gym",
      nextExpected: today,
      cadence: "weekly",
      avgCents: -4500,
    });
    expect(
      forecastEvents({ bills: [gym], planned: [], today, days: 20 }),
    ).toEqual([
      { date: "2026-09-07", name: "Gym", amountCents: -4500, kind: "bill" },
      { date: "2026-09-13", name: "Gym", amountCents: -4500, kind: "bill" },
      { date: "2026-09-20", name: "Gym", amountCents: -4500, kind: "bill" },
    ]);
  });

  it("gives recurring income a positive amount and expense bills a negative one", () => {
    const paycheck = bill({
      id: 1,
      merchant: "Acme Payroll",
      nextExpected: "2026-09-11",
      cadence: "weekly",
      avgCents: 250000,
      isIncome: true,
    });
    const rent = bill({
      id: 2,
      merchant: "Rent",
      nextExpected: "2026-09-11",
      cadence: "monthly",
      avgCents: -180000,
    });
    // days: 7 -> to = 09-13, so only the 09-11 occurrence of each is in range.
    expect(
      forecastEvents({ bills: [paycheck, rent], planned: [], today, days: 7 }),
    ).toEqual([
      {
        date: "2026-09-11",
        name: "Acme Payroll",
        amountCents: 250000,
        kind: "income",
      },
      { date: "2026-09-11", name: "Rent", amountCents: -180000, kind: "bill" },
    ]);
  });

  it("ignores inactive and dismissed bills", () => {
    const inactive = bill({
      id: 1,
      merchant: "Old sub",
      nextExpected: "2026-09-11",
      active: false,
    });
    const dismissed = bill({
      id: 2,
      merchant: "Dismissed sub",
      nextExpected: "2026-09-11",
      dismissed: true,
    });
    expect(
      forecastEvents({
        bills: [inactive, dismissed],
        planned: [],
        today,
        days: 30,
      }),
    ).toEqual([]);
  });

  it("sorts events by date, then by name", () => {
    const zGym = bill({
      id: 1,
      merchant: "Zzz Gym",
      nextExpected: "2026-09-11",
    });
    const netflix = bill({
      id: 2,
      merchant: "Netflix",
      nextExpected: "2026-09-11",
    });
    const events = forecastEvents({
      bills: [zGym, netflix],
      planned: [],
      today,
      days: 7,
    });
    expect(events.map((e) => e.name)).toEqual(["Netflix", "Zzz Gym"]);
  });
});

describe("forecastEvents — planned expenses", () => {
  it("includes a one-time planned expense whose due date falls inside the horizon", () => {
    const item = planned({
      key: "planned:1",
      id: 1,
      name: "Car registration",
      every: "once",
      nextDue: "2026-09-20",
      amountCents: 18000,
    });
    expect(
      forecastEvents({ bills: [], planned: [item], today, days: 30 }),
    ).toEqual([
      {
        date: "2026-09-20",
        name: "Car registration",
        amountCents: -18000,
        kind: "planned",
      },
    ]);
  });

  it("excludes a one-time planned expense whose due date falls outside the horizon", () => {
    const item = planned({
      key: "planned:2",
      id: 2,
      name: "Roof repair",
      every: "once",
      nextDue: "2026-12-01",
      amountCents: 500000,
    });
    expect(
      forecastEvents({ bills: [], planned: [item], today, days: 30 }),
    ).toEqual([]);
  });

  it("steps a quarterly planned expense forward each time it recurs inside a longer horizon", () => {
    // nextDue 07-01 is in the past; quarterly steps from July land on
    // 10-01 and, three months later, 2027-01-01. days: 120 -> to = 2027-01-04,
    // so both fall inside and the next step (2027-04-01) is excluded.
    const item = planned({
      key: "planned:3",
      id: 3,
      name: "Car insurance",
      every: "quarter",
      nextDue: "2026-07-01",
      amountCents: 60000,
    });
    expect(
      forecastEvents({ bills: [], planned: [item], today, days: 120 }),
    ).toEqual([
      {
        date: "2026-10-01",
        name: "Car insurance",
        amountCents: -60000,
        kind: "planned",
      },
      {
        date: "2027-01-01",
        name: "Car insurance",
        amountCents: -60000,
        kind: "planned",
      },
    ]);
  });
});
