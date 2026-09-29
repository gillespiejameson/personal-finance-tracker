import { formatCents } from "@/lib/money";
import type { PlanTotals } from "./types";

function monthLabel(month: string): string {
  return new Date(`${month}-15T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function monthsPhrase(n: number): string {
  return `${n} month${n === 1 ? "" : "s"}`;
}

function amount(cents: number): string {
  return formatCents(Math.abs(cents), { sign: "never" });
}

/**
 * A plain-language summary of how avalanche and snowball compare, given
 * each strategy's totals. Pure and side-effect free so it can be unit
 * tested without rendering.
 */
export function comparisonSentence(comparison: {
  avalanche: PlanTotals;
  snowball: PlanTotals;
}): string {
  const A = comparison.avalanche;
  const S = comparison.snowball;

  if (!A.finished && !S.finished)
    return "Neither strategy clears these debts within 50 years at the current minimums.";

  if (A.finished !== S.finished) {
    const winner = A.finished ? "Avalanche" : "Snowball";
    const winnerPayoffMonth = (A.finished ? A : S).payoffMonth as string;
    return `${winner} clears everything by ${monthLabel(winnerPayoffMonth)}; the other doesn't within 50 years.`;
  }

  const interestDiff = S.interestCents - A.interestCents;
  const monthsDiff = S.months - A.months;

  if (interestDiff === 0 && monthsDiff === 0)
    return "Both strategies finish the same month with the same interest.";

  if (interestDiff >= 0 && monthsDiff >= 0) {
    const parts: string[] = [];
    if (interestDiff > 0) parts.push(amount(interestDiff));
    if (monthsDiff > 0) parts.push(monthsPhrase(monthsDiff));
    return `Avalanche saves ${parts.join(" and ")} over snowball.`;
  }

  if (interestDiff <= 0 && monthsDiff <= 0) {
    const parts: string[] = [];
    if (interestDiff < 0) parts.push(amount(interestDiff));
    if (monthsDiff < 0) parts.push(monthsPhrase(Math.abs(monthsDiff)));
    return `Snowball saves ${parts.join(" and ")} over avalanche.`;
  }

  // Mixed signs: one strategy wins on interest, the other on speed.
  if (interestDiff > 0)
    return `Avalanche pays ${amount(interestDiff)} less interest; snowball finishes ${monthsPhrase(Math.abs(monthsDiff))} sooner.`;
  return `Snowball pays ${amount(interestDiff)} less interest; avalanche finishes ${monthsPhrase(Math.abs(monthsDiff))} sooner.`;
}
