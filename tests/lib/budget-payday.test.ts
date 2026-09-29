import { describe, expect, it } from "vitest";
import {
  inferPayday,
  nextPayday,
  PAYDAY_KEY,
  resolvePayday,
} from "@/lib/budget/payday";
import { openDb } from "@/lib/db/client";
import type { Bill } from "@/lib/recurring/refresh";
import { setSetting } from "@/lib/settings";

const bill = (p: Partial<Bill>): Bill => ({
  id: 1,
  merchant: "Acme Payroll",
  categoryId: 1,
  categoryName: "Paycheck",
  color: "#34C759",
  cadence: "weekly",
  intervalDays: 7,
  avgCents: 250000,
  monthlyCents: 1083333,
  occurrences: 12,
  firstSeen: "2026-06-05",
  lastSeen: "2026-09-04",
  nextExpected: "2026-09-11",
  dueInDays: 5,
  isNew: false,
  active: true,
  dismissed: false,
  recentAmounts: [],
  confidence: "confirmed",
  manual: false,
  isIncome: true,
  ...p,
});

describe("nextPayday", () => {
  it("weekly steps from an anchor in the past to the first date after today", () => {
    expect(
      nextPayday({ schedule: "weekly", anchor: "2026-06-05" }, "2026-09-06"),
    ).toBe("2026-09-11");
    expect(
      nextPayday({ schedule: "weekly", anchor: "2026-06-05" }, "2026-09-11"),
    ).toBe("2026-09-18"); // payday itself → next one
  });
  it("biweekly with a future anchor returns the anchor", () => {
    expect(
      nextPayday({ schedule: "biweekly", anchor: "2026-09-20" }, "2026-09-06"),
    ).toBe("2026-09-20");
  });
  it("semimonthly picks the next of the two days, rolling into next month", () => {
    expect(
      nextPayday({ schedule: "semimonthly", days: [1, 15] }, "2026-09-06"),
    ).toBe("2026-09-15");
    expect(
      nextPayday({ schedule: "semimonthly", days: [1, 15] }, "2026-09-15"),
    ).toBe("2026-10-01");
  });
  it("monthly clamps the day to the month length", () => {
    expect(nextPayday({ schedule: "monthly", day: 31 }, "2026-09-06")).toBe(
      "2026-09-30",
    );
    expect(nextPayday({ schedule: "monthly", day: 31 }, "2026-09-30")).toBe(
      "2026-10-31",
    );
    expect(nextPayday({ schedule: "monthly", day: 30 }, "2027-02-01")).toBe(
      "2027-02-28",
    );
  });
});

describe("inferPayday", () => {
  it("uses the largest active income bill", () => {
    expect(
      inferPayday([
        bill({}),
        bill({
          id: 2,
          cadence: "monthly",
          monthlyCents: 50000,
          nextExpected: "2026-09-25",
        }),
      ]),
    ).toEqual({
      schedule: "weekly",
      anchor: "2026-09-11",
    });
    expect(
      inferPayday([bill({ cadence: "monthly", nextExpected: "2026-09-25" })]),
    ).toEqual({ schedule: "monthly", day: 25 });
    expect(inferPayday([bill({ cadence: "quarterly" })])).toBeNull();
    expect(inferPayday([bill({ isIncome: false })])).toBeNull();
    expect(inferPayday([bill({ dismissed: true })])).toBeNull();
  });
});

describe("resolvePayday", () => {
  it("infers from bills when no setting is stored, and uses the stored setting once set", () => {
    const db = openDb(":memory:");
    const bills = [bill({})];
    const inferred = resolvePayday(db, bills, "2026-09-06");
    expect(inferred?.inferred).toBe(true);
    expect(inferred?.config).toEqual({
      schedule: "weekly",
      anchor: "2026-09-11",
    });
    expect(inferred?.next).toBe("2026-09-11");
    expect(inferred?.daysUntil).toBe(5);

    setSetting(db, PAYDAY_KEY, { schedule: "monthly", day: 1 });
    const resolved = resolvePayday(db, bills, "2026-09-06");
    expect(resolved?.inferred).toBe(false);
    expect(resolved?.config).toEqual({ schedule: "monthly", day: 1 });
    expect(resolved?.next).toBe("2026-10-01");
  });
});
