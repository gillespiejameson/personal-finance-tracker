import { describe, expect, it } from "vitest";
import {
  accrued,
  monthlyShare,
  nextDue,
  periodMonths,
  previousDue,
} from "@/lib/spreading/math";

describe("periodMonths", () => {
  it("is fixed for year and quarter", () => {
    expect(periodMonths("year", "2026-01-01", "2026-06-01")).toBe(12);
    expect(periodMonths("quarter", "2026-01-01", "2026-06-01")).toBe(3);
  });
  it("for once, counts months from the created month to the due month", () => {
    expect(periodMonths("once", "2026-09-06", "2026-12-01")).toBe(3);
    // Same calendar month: clamped to a minimum of 1.
    expect(periodMonths("once", "2026-09-06", "2026-09-20")).toBe(1);
  });
});

describe("nextDue", () => {
  it("year: the next anniversary (month/day) on/after today", () => {
    expect(nextDue("year", "2026-03-15", "2026-09-06")).toBe("2027-03-15");
  });
  it("year: clamps Feb 29 to Feb 28 in a non-leap year", () => {
    expect(nextDue("year", "2024-02-29", "2026-09-06")).toBe("2027-02-28");
  });
  it("quarter: steps +3 months from the due date until on/after today", () => {
    expect(nextDue("quarter", "2026-01-10", "2026-09-06")).toBe("2026-10-10");
  });
  it("once: the due date itself if still ahead, else null", () => {
    expect(nextDue("once", "2026-12-01", "2026-09-06")).toBe("2026-12-01");
    expect(nextDue("once", "2026-08-01", "2026-09-06")).toBeNull();
  });
});

describe("previousDue", () => {
  it("shifts next back by the period, clamping the day", () => {
    expect(previousDue("year", "2027-03-15", 12)).toBe("2026-03-15");
    expect(previousDue("year", "2027-02-28", 12)).toBe("2026-02-28");
    // Shifting Mar 31 back 1 month lands on Feb, clamped to its last day.
    expect(previousDue("quarter", "2026-03-31", 1)).toBe("2026-02-28");
  });
});

describe("monthlyShare", () => {
  it("rounds the amount over the period", () => {
    expect(monthlyShare(120000, 12)).toBe(10000);
    expect(monthlyShare(100000, 3)).toBe(33333);
  });
});

describe("accrued", () => {
  // Derivation for the two cases below (previousDue 2026-03-15, monthly
  // 10000, amount 120000): a month only counts once today's day-of-month
  // reaches previousDue's day-of-month (the 15th) in that calendar month —
  // this is what makes accrual reach 100% exactly on the next due date
  // (2027-03-15) and not a day sooner.
  //  - today 2026-09-06 (day 6 < 15): complete months are Apr15, May15,
  //    Jun15, Jul15, Aug15 — 5 whole months elapsed, not yet Sep15's.
  //    5 * 10000 = 50000.
  //  - today 2027-03-14 (day 14 < 15, one day before the anniversary):
  //    11 whole months elapsed (the 12th completes tomorrow, at nextDue).
  //    11 * 10000 = 110000.
  it("is whole months elapsed since previousDue, times the monthly share", () => {
    expect(
      accrued({
        amountCents: 120000,
        monthlyCents: 10000,
        previousDue: "2026-03-15",
        today: "2026-09-06",
      }),
    ).toBe(50000);
    expect(
      accrued({
        amountCents: 120000,
        monthlyCents: 10000,
        previousDue: "2026-03-15",
        today: "2027-03-14",
      }),
    ).toBe(110000);
  });
  it("is 0 within the same calendar month as previousDue", () => {
    expect(
      accrued({
        amountCents: 120000,
        monthlyCents: 10000,
        previousDue: "2026-03-15",
        today: "2026-03-20",
      }),
    ).toBe(0);
  });
  it("caps at the item's amount", () => {
    expect(
      accrued({
        amountCents: 50000,
        monthlyCents: 10000,
        previousDue: "2026-03-15",
        today: "2027-03-14",
      }),
    ).toBe(50000);
  });
});
