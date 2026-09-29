import { describe, expect, it } from "vitest";
import { safeToSpend } from "@/lib/budget/safeToSpend";

describe("safeToSpend", () => {
  it("subtracts unposted bills and divides by days until payday", () => {
    expect(
      safeToSpend({
        variableRemainingCents: 50000,
        unpostedBillsCents: 8000,
        daysUntil: 6,
        horizon: "2026-09-12",
        horizonKind: "payday",
      }),
    ).toMatchObject({ totalCents: 42000, perDayCents: 7000 });
  });
  it("floors at zero and never divides by less than one day", () => {
    expect(
      safeToSpend({
        variableRemainingCents: 1000,
        unpostedBillsCents: 5000,
        daysUntil: 0,
        horizon: "2026-09-06",
        horizonKind: "monthEnd",
      }),
    ).toMatchObject({ totalCents: 0, perDayCents: 0 });
    expect(
      safeToSpend({
        variableRemainingCents: 1001,
        unpostedBillsCents: 0,
        daysUntil: 1,
        horizon: "2026-09-07",
        horizonKind: "payday",
      }).perDayCents,
    ).toBe(1001);
    expect(
      safeToSpend({
        variableRemainingCents: 1001,
        unpostedBillsCents: 0,
        daysUntil: 2,
        horizon: "2026-09-08",
        horizonKind: "payday",
      }).perDayCents,
    ).toBe(500);
  });
  it("computes the rest-of-month variant from the same remaining total", () => {
    const s = safeToSpend({
      variableRemainingCents: 42000,
      unpostedBillsCents: 4000,
      daysUntil: 5,
      horizon: "2026-09-11",
      horizonKind: "payday",
      restOfMonth: {
        unpostedBillsCents: 5500,
        daysUntil: 25,
        horizon: "2026-09-30",
      },
    });
    expect(s.restOfMonth).toEqual({
      totalCents: 36500,
      perDayCents: 1460,
      unpostedBillsCents: 5500,
      horizon: "2026-09-30",
      daysUntil: 25,
    });
  });
  it("clamps the rest-of-month total at zero and the divisor at one day", () => {
    const s = safeToSpend({
      variableRemainingCents: 1000,
      unpostedBillsCents: 0,
      daysUntil: 3,
      horizon: "2026-09-11",
      horizonKind: "payday",
      restOfMonth: {
        unpostedBillsCents: 5000,
        daysUntil: 0,
        horizon: "2026-09-30",
      },
    });
    expect(s.restOfMonth).toMatchObject({
      totalCents: 0,
      perDayCents: 0,
      daysUntil: 1,
    });
  });
  it("leaves restOfMonth null when not asked for", () => {
    const s = safeToSpend({
      variableRemainingCents: 1000,
      unpostedBillsCents: 0,
      daysUntil: 3,
      horizon: "2026-09-30",
      horizonKind: "monthEnd",
    });
    expect(s.restOfMonth).toBeNull();
  });
});
