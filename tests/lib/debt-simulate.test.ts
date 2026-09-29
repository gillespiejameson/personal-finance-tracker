import { describe, expect, it } from "vitest";
import {
  compareStrategies,
  monthlyInterest,
  simulatePayoff,
} from "@/lib/debt/simulate";

const card = {
  id: 1,
  name: "Card",
  balanceCents: 100000,
  aprBps: 2400,
  minPaymentCents: 5000,
}; // $1,000 at 24%, $50 min
const loan = {
  id: 2,
  name: "Loan",
  balanceCents: 500000,
  aprBps: 600,
  minPaymentCents: 15000,
}; // $5,000 at 6%, $150 min

describe("monthlyInterest", () => {
  it("rounds to cents", () => {
    expect(monthlyInterest(100000, 2400)).toBe(2000);
    expect(monthlyInterest(12345, 1999)).toBe(206);
  });
});

describe("simulatePayoff", () => {
  it("pays minimums, accrues interest, and finishes", () => {
    const p = simulatePayoff([card], 0, "avalanche", "2026-09");
    // Month 1: interest 2000 → balance 102000, pay 5000 → 97000. Month 2: interest 1940 → 98940, pay 5000 → 93940.
    expect(p.series[0]).toEqual({ month: "2026-09", remainingCents: 97000 });
    expect(p.series[1]).toEqual({ month: "2026-10", remainingCents: 93940 });
    expect(p.totals.finished).toBe(true);
    expect(p.debts[0].payoffMonth).toBe(p.totals.payoffMonth);
    expect(p.debts[0].interestCents + card.balanceCents).toBe(
      p.debts[0].paidCents,
    );
  });
  it("never pays more than balance plus interest in the final month", () => {
    const p = simulatePayoff(
      [{ ...card, balanceCents: 3000 }],
      100000,
      "avalanche",
      "2026-09",
    );
    expect(p.totals.months).toBe(1);
    expect(p.debts[0].paidCents).toBe(3000 + monthlyInterest(3000, 2400));
  });
  it("avalanche targets the highest APR and rolls freed minimums forward", () => {
    const a = simulatePayoff([card, loan], 20000, "avalanche", "2026-09");
    const s = simulatePayoff([card, loan], 20000, "snowball", "2026-09");
    expect(a.order).toEqual([1, 2]); // card first (24% > 6%)
    expect(s.order).toEqual([1, 2]); // card also smaller balance
    expect(a.totals.interestCents).toBeLessThanOrEqual(s.totals.interestCents);
    const cardDone = a.debts.find((d) => d.id === 1)?.payoffMonth as string;
    // After the card is paid, the loan receives its own minimum (15000) plus
    // the pool (20000 extra + 5000 freed from the card) = 40000 total applied
    // against interest of a few thousand cents on a ~$3-4k balance, so the
    // month-over-month drop comfortably clears a 30000 floor.
    const idx = a.series.findIndex((x) => x.month === cardDone);
    expect(a.series[idx + 1].remainingCents).toBeLessThan(
      a.series[idx].remainingCents - 15000 - 20000 + 5000,
    );
  });
  it("totals.payoffMonth is whichever debt actually finishes last, not just the last one in the target order", () => {
    // A small, low-rate debt with a strong minimum can fully amortize on its
    // own well before its turn as the extra-payment target, so the debt
    // ordered last can finish chronologically first.
    const bigApr = {
      id: 10,
      name: "Big",
      balanceCents: 250000,
      aprBps: 2400,
      minPaymentCents: 7500,
    }; // $2,500 at 24%, $75 min
    const smallLowApr = {
      id: 11,
      name: "Small",
      balanceCents: 80000,
      aprBps: 999,
      minPaymentCents: 4000,
    }; // $800 at 9.99%, $40 min
    const p = simulatePayoff([bigApr, smallLowApr], 0, "avalanche", "2026-09");
    expect(p.order).toEqual([10, 11]); // avalanche targets the higher APR first
    expect(p.totals.finished).toBe(true);
    const bigPayoff = p.debts.find((d) => d.id === 10)?.payoffMonth as string;
    const smallPayoff = p.debts.find((d) => d.id === 11)?.payoffMonth as string;
    expect(smallPayoff < bigPayoff).toBe(true);
    expect(p.totals.payoffMonth).toBe(bigPayoff);
  });
  it("snowball prefers the smaller balance even at a lower rate", () => {
    const small = {
      id: 3,
      name: "Small",
      balanceCents: 20000,
      aprBps: 500,
      minPaymentCents: 2500,
    };
    expect(
      simulatePayoff([card, small], 0, "snowball", "2026-09").order,
    ).toEqual([3, 1]);
    expect(
      simulatePayoff([card, small], 0, "avalanche", "2026-09").order,
    ).toEqual([1, 3]);
  });
  it("flags a debt whose minimum does not cover interest", () => {
    const p = simulatePayoff(
      [{ ...card, balanceCents: 1000000, minPaymentCents: 1000 }],
      0,
      "avalanche",
      "2026-09",
    );
    expect(p.totals.finished).toBe(false);
    expect(p.totals.months).toBe(600);
    expect(p.debts[0]).toMatchObject({ stalled: true, payoffMonth: null });
  });
  it("skips zero balances and handles no debts", () => {
    expect(
      simulatePayoff([{ ...card, balanceCents: 0 }], 0, "avalanche", "2026-09")
        .totals,
    ).toMatchObject({ months: 0, finished: true, payoffMonth: null });
    expect(simulatePayoff([], 0, "snowball", "2026-09").series).toEqual([]);
  });
});

describe("compareStrategies", () => {
  it("returns both totals", () => {
    const c = compareStrategies([card, loan], 20000, "2026-09");
    expect(c.avalanche.interestCents).toBeLessThanOrEqual(
      c.snowball.interestCents,
    );
    expect(c.avalanche.finished && c.snowball.finished).toBe(true);
  });
});
