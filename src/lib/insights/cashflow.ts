import { monthTotals, type Totals } from "./aggregate";
import type { Line } from "./lines";

export type MonthRow = Totals & { month: string };

export function cashFlowHistory(lines: Line[], months: string[]): MonthRow[] {
  const totals = monthTotals(lines);
  return months.map((month) => ({
    month,
    ...(totals.get(month) ?? {
      income: 0,
      fixed: 0,
      variable: 0,
      savings: 0,
      spent: 0,
      leftover: 0,
    }),
  }));
}

export type WaterfallStep = {
  label: string;
  delta: number;
  start: number;
  end: number;
};

export function waterfallSteps(t: Totals): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let run = 0;
  const push = (label: string, delta: number) => {
    steps.push({ label, delta, start: run, end: run + delta });
    run += delta;
  };
  push("Income", t.income);
  push("Fixed", -t.fixed);
  push("Variable", -t.variable);
  push("Savings", -t.savings);
  steps.push({
    label: "Leftover",
    delta: t.leftover,
    start: 0,
    end: t.leftover,
  });
  return steps;
}
