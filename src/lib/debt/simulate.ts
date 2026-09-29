import { shiftMonth } from "@/lib/insights/page";
import type {
  DebtInput,
  DebtResult,
  Plan,
  PlanTotals,
  Strategy,
} from "./types";

export const MAX_MONTHS = 600;

/** Interest for one month, rounded to the nearest cent. */
export function monthlyInterest(balanceCents: number, aprBps: number): number {
  return Math.round((balanceCents * aprBps) / 10000 / 12);
}

/**
 * The payoff order, fixed once from the starting balances/rates: avalanche
 * targets the highest APR (ties broken by the smaller balance), snowball
 * targets the smallest balance (ties broken by the higher APR).
 */
function computeOrder(debts: DebtInput[], strategy: Strategy): number[] {
  const sorted = [...debts].sort((a, b) => {
    if (strategy === "avalanche") {
      if (a.aprBps !== b.aprBps) return b.aprBps - a.aprBps;
      return a.balanceCents - b.balanceCents;
    }
    if (a.balanceCents !== b.balanceCents)
      return a.balanceCents - b.balanceCents;
    return b.aprBps - a.aprBps;
  });
  return sorted.map((d) => d.id);
}

/**
 * Month-by-month avalanche/snowball simulation, pure and side-effect free.
 *
 * Each month: every debt with a balance accrues interest and pays its
 * minimum (capped at balance + interest); the extra payment plus the
 * minimums of any already-paid-off debts ("the pool") then goes to the
 * single current target (the first unpaid debt in `order`), also capped at
 * its balance. Stops when every balance is 0, or after `MAX_MONTHS` months
 * (in which case `finished` is false and any debt whose balance never
 * shrank below its starting balance is flagged `stalled`).
 */
export function simulatePayoff(
  debts: DebtInput[],
  extraCents: number,
  strategy: Strategy,
  startMonth: string,
): Plan {
  const order = computeOrder(debts, strategy);
  const startingBalance = new Map(debts.map((d) => [d.id, d.balanceCents]));
  const balances = new Map(debts.map((d) => [d.id, d.balanceCents]));
  const interestCents = new Map(debts.map((d) => [d.id, 0]));
  const paidCents = new Map(debts.map((d) => [d.id, 0]));
  const payoffMonth = new Map<number, string | null>(
    debts.map((d) => [d.id, null]),
  );
  const series: { month: string; remainingCents: number }[] = [];

  const anyBalance = () => order.some((id) => (balances.get(id) ?? 0) > 0);

  let month = startMonth;
  let m = 0;
  while (anyBalance() && m < MAX_MONTHS) {
    m++;

    for (const d of debts) {
      const bal = balances.get(d.id) ?? 0;
      if (bal <= 0) continue;
      const interest = monthlyInterest(bal, d.aprBps);
      interestCents.set(d.id, (interestCents.get(d.id) ?? 0) + interest);
      const withInterest = bal + interest;
      const pay = Math.min(d.minPaymentCents, withInterest);
      paidCents.set(d.id, (paidCents.get(d.id) ?? 0) + pay);
      const remaining = withInterest - pay;
      balances.set(d.id, remaining);
      if (remaining === 0 && payoffMonth.get(d.id) === null)
        payoffMonth.set(d.id, month);
    }

    // A debt that reaches zero this month still contributes its full
    // minimum to this month's pool (it "would have" paid that minimum had
    // it not been paid off). This is deliberate and slightly optimistic:
    // in reality that last payment may have been smaller than the minimum.
    let pool = extraCents;
    for (const d of debts) {
      if ((balances.get(d.id) ?? 0) === 0 && payoffMonth.get(d.id) !== null)
        pool += d.minPaymentCents;
    }

    // If the pool is larger than the target's remaining balance, the
    // leftover is not cascaded to the next debt in `order` within the same
    // month — it simply carries into next month's pool via the target's
    // freed-up minimum once it shows up as paid off above. This is a
    // deliberate simplification, not a rollover of the exact leftover cents.
    const targetId = order.find((id) => (balances.get(id) ?? 0) > 0);
    if (targetId !== undefined && pool > 0) {
      const bal = balances.get(targetId) ?? 0;
      const pay = Math.min(pool, bal);
      paidCents.set(targetId, (paidCents.get(targetId) ?? 0) + pay);
      const remaining = bal - pay;
      balances.set(targetId, remaining);
      if (remaining === 0 && payoffMonth.get(targetId) === null)
        payoffMonth.set(targetId, month);
    }

    const remainingTotal = order.reduce(
      (sum, id) => sum + (balances.get(id) ?? 0),
      0,
    );
    series.push({ month, remainingCents: remainingTotal });
    month = shiftMonth(month, 1);
  }

  const finished = !anyBalance();
  const debtResults: DebtResult[] = order.map((id) => {
    const remaining = balances.get(id) ?? 0;
    const start = startingBalance.get(id) ?? 0;
    return {
      id,
      payoffMonth: payoffMonth.get(id) ?? null,
      interestCents: interestCents.get(id) ?? 0,
      paidCents: paidCents.get(id) ?? 0,
      stalled: !finished && remaining > 0 && remaining >= start,
    };
  });

  // The debt-free month is whichever debt actually reaches zero last, not
  // necessarily the last one in the target order: a low-priority debt can
  // still be fully retired by its own minimum before its turn as the target.
  let latestPayoffMonth: string | null = null;
  if (finished) {
    for (const id of order) {
      const pm = payoffMonth.get(id) ?? null;
      if (pm !== null && (latestPayoffMonth === null || pm > latestPayoffMonth))
        latestPayoffMonth = pm;
    }
  }
  const totals: PlanTotals = {
    months: m,
    interestCents: debtResults.reduce((s, d) => s + d.interestCents, 0),
    paidCents: debtResults.reduce((s, d) => s + d.paidCents, 0),
    finished,
    payoffMonth: latestPayoffMonth,
  };

  return { strategy, debts: debtResults, totals, series, order };
}

/** Both strategies' full plans, computed once each. */
export function comparePlans(
  debts: DebtInput[],
  extraCents: number,
  startMonth: string,
): { avalanche: Plan; snowball: Plan } {
  return {
    avalanche: simulatePayoff(debts, extraCents, "avalanche", startMonth),
    snowball: simulatePayoff(debts, extraCents, "snowball", startMonth),
  };
}

export function compareStrategies(
  debts: DebtInput[],
  extraCents: number,
  startMonth: string,
): { avalanche: PlanTotals; snowball: PlanTotals } {
  const { avalanche, snowball } = comparePlans(debts, extraCents, startMonth);
  return { avalanche: avalanche.totals, snowball: snowball.totals };
}
