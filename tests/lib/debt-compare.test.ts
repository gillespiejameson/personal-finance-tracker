import { describe, expect, it } from "vitest";
import { comparisonSentence } from "@/lib/debt/compare";
import type { PlanTotals } from "@/lib/debt/types";

function totals(overrides: Partial<PlanTotals>): PlanTotals {
  return {
    months: 12,
    interestCents: 10000,
    paidCents: 100000,
    finished: true,
    payoffMonth: "2027-09",
    ...overrides,
  };
}

describe("comparisonSentence", () => {
  it("says neither strategy finishes when both are unfinished", () => {
    const sentence = comparisonSentence({
      avalanche: totals({ finished: false, payoffMonth: null, months: 600 }),
      snowball: totals({ finished: false, payoffMonth: null, months: 600 }),
    });
    expect(sentence).toBe(
      "Neither strategy clears these debts within 50 years at the current minimums.",
    );
  });

  it("names the strategy that finishes when only avalanche does", () => {
    const sentence = comparisonSentence({
      avalanche: totals({ finished: true, payoffMonth: "2027-03" }),
      snowball: totals({ finished: false, payoffMonth: null, months: 600 }),
    });
    expect(sentence).toBe(
      "Avalanche clears everything by March 2027; the other doesn't within 50 years.",
    );
  });

  it("names the strategy that finishes when only snowball does", () => {
    const sentence = comparisonSentence({
      avalanche: totals({ finished: false, payoffMonth: null, months: 600 }),
      snowball: totals({ finished: true, payoffMonth: "2027-03" }),
    });
    expect(sentence).toBe(
      "Snowball clears everything by March 2027; the other doesn't within 50 years.",
    );
  });

  it("reports a tie when both finish the same month with the same interest", () => {
    const sentence = comparisonSentence({
      avalanche: totals({ months: 12, interestCents: 5000 }),
      snowball: totals({ months: 12, interestCents: 5000 }),
    });
    expect(sentence).toBe(
      "Both strategies finish the same month with the same interest.",
    );
  });

  it("credits avalanche when it saves both interest and months", () => {
    const sentence = comparisonSentence({
      avalanche: totals({ months: 10, interestCents: 4000 }),
      snowball: totals({ months: 12, interestCents: 5000 }),
    });
    expect(sentence).toBe("Avalanche saves $10.00 and 2 months over snowball.");
  });

  it("credits avalanche on interest alone when months tie (off by 542 cents)", () => {
    const sentence = comparisonSentence({
      avalanche: totals({ months: 12, interestCents: 5000 }),
      snowball: totals({ months: 12, interestCents: 5542 }),
    });
    expect(sentence).toBe("Avalanche saves $5.42 over snowball.");
  });

  it("credits avalanche on months alone when interest ties", () => {
    const sentence = comparisonSentence({
      avalanche: totals({ months: 10, interestCents: 5000 }),
      snowball: totals({ months: 11, interestCents: 5000 }),
    });
    expect(sentence).toBe("Avalanche saves 1 month over snowball.");
  });

  it("credits snowball when it saves both interest and months", () => {
    const sentence = comparisonSentence({
      avalanche: totals({ months: 12, interestCents: 5000 }),
      snowball: totals({ months: 10, interestCents: 4000 }),
    });
    expect(sentence).toBe("Snowball saves $10.00 and 2 months over avalanche.");
  });

  it("reports mixed results when avalanche has less interest but finishes later", () => {
    const sentence = comparisonSentence({
      avalanche: totals({ months: 14, interestCents: 4000 }),
      snowball: totals({ months: 12, interestCents: 5000 }),
    });
    expect(sentence).toBe(
      "Avalanche pays $10.00 less interest; snowball finishes 2 months sooner.",
    );
  });

  it("reports mixed results when snowball has less interest but finishes later", () => {
    const sentence = comparisonSentence({
      avalanche: totals({ months: 10, interestCents: 5000 }),
      snowball: totals({ months: 14, interestCents: 4000 }),
    });
    expect(sentence).toBe(
      "Snowball pays $10.00 less interest; avalanche finishes 4 months sooner.",
    );
  });
});
