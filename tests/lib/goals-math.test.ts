import { describe, expect, it } from "vitest";
import { goalMath, monthsRemaining } from "@/lib/goals/math";

describe("monthsRemaining", () => {
  it("counts months inclusive with a floor of one", () => {
    expect(monthsRemaining("2026-09-06", "2026-12-15")).toBe(4);
    expect(monthsRemaining("2026-09-06", "2026-09-30")).toBe(1);
    expect(monthsRemaining("2026-09-06", "2026-08-01")).toBe(1);
  });
});
describe("goalMath", () => {
  it("derives progress, percent and the monthly contribution", () => {
    expect(
      goalMath({
        targetCents: 200000,
        startingCents: 20000,
        contributionsCents: 30000,
        targetDate: "2026-12-15",
        today: "2026-09-06",
      }),
    ).toEqual({
      progressCents: 50000,
      pct: 0.25,
      monthsRemaining: 4,
      monthlyNeededCents: 37500,
      reached: false,
    });
  });
  it("rounds the contribution up and caps progress", () => {
    expect(
      goalMath({
        targetCents: 100000,
        startingCents: 0,
        contributionsCents: 1,
        targetDate: "2026-11-01",
        today: "2026-09-06",
      }).monthlyNeededCents,
    ).toBe(33333);
    expect(
      goalMath({
        targetCents: 100000,
        startingCents: 120000,
        contributionsCents: 0,
        targetDate: null,
        today: "2026-09-06",
      }),
    ).toEqual({
      progressCents: 120000,
      pct: 1,
      monthsRemaining: null,
      monthlyNeededCents: null,
      reached: true,
    });
  });
  it("shows only progress without a date", () => {
    expect(
      goalMath({
        targetCents: 100000,
        startingCents: 0,
        contributionsCents: 25000,
        targetDate: null,
        today: "2026-09-06",
      }),
    ).toMatchObject({ pct: 0.25, monthlyNeededCents: null });
  });
});
