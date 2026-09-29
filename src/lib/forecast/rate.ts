import type { BudgetLeaf, BudgetPage } from "@/lib/budget/types";
import { monthEnd } from "@/lib/dates";
import type { SpendRate } from "./types";

function isVariable(leaf: BudgetLeaf): boolean {
  return !leaf.isFixed && !leaf.isSavings;
}

/**
 * Everyday spend rate. With an open budget for the current month: the rest
 * of this month drains at `max(0, variable remaining) / days left`
 * (inclusive of today), while later months use `variable budgeted / days in
 * that month` (see `forecastSeries`). The budget's variable leaves never
 * include uncategorized transactions, so `avgUncategorizedCents` (a 3-month
 * average, already spread over 30 days) is added on top of both figures to
 * keep the budget path on the same spend basis as the average-fallback path,
 * whose bucketing already folds uncategorized spend into "variable".
 * Without a usable budget, both figures fall back to the 3-month variable
 * average. With neither, the rate is zero.
 */
export function spendRate(i: {
  budget: BudgetPage | null;
  avgVariableCents: number | null;
  avgUncategorizedCents: number | null;
  today: string;
}): SpendRate {
  const { budget, avgVariableCents, avgUncategorizedCents, today } = i;

  if (budget?.hasBudget && budget.gate.open) {
    const variableLeaves = budget.groups
      .flatMap((g) => g.leaves)
      .filter(isVariable);
    const remainingCents = variableLeaves.reduce(
      (sum, l) => sum + l.remaining,
      0,
    );
    const budgetedCents = variableLeaves.reduce(
      (sum, l) => sum + l.budgeted,
      0,
    );
    const lastDay = Number(monthEnd(today.slice(0, 7)).slice(8, 10));
    const todayDay = Number(today.slice(8, 10));
    const daysLeft = lastDay - todayDay + 1;
    const uncategorizedDailyCents =
      avgUncategorizedCents !== null
        ? Math.round(avgUncategorizedCents / 30)
        : 0;
    return {
      source: "budget",
      thisMonthDailyCents:
        Math.round(Math.max(0, remainingCents) / daysLeft) +
        uncategorizedDailyCents,
      laterMonthlyCents: budgetedCents + (avgUncategorizedCents ?? 0),
    };
  }

  if (avgVariableCents !== null) {
    return {
      source: "average",
      thisMonthDailyCents: Math.round(avgVariableCents / 30),
      laterMonthlyCents: avgVariableCents,
    };
  }

  return { source: "none", thisMonthDailyCents: 0, laterMonthlyCents: 0 };
}
