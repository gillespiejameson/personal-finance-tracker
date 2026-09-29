import {
  type CategoryRow,
  categoryBreakdown,
  completeMonths,
  dataMonths,
  monthTotals,
  monthTotalsThrough,
  type Totals,
} from "./aggregate";
import {
  cashFlowHistory,
  type MonthRow,
  type WaterfallStep,
  waterfallSteps,
} from "./cashflow";
import type { Line } from "./lines";
import { type MerchantStat, topMerchants } from "./merchants";

export type AvgMonths = 3 | 6 | 12;

export type InsightsPage = {
  month: string;
  months: string[];
  totals: Totals;
  lastTotals: Totals;
  avgWindow: string[];
  /** The window the reader asked for; `avgWindow` may be shorter than this. */
  avgMonths: AvgMonths;
  /** The month-over-month comparison is cut at today's day of month. */
  partialComparison: boolean;
  breakdown: CategoryRow[];
  waterfall: WaterfallStep[];
  history: MonthRow[];
  topByDollars: MerchantStat[];
  topByCount: MerchantStat[];
};

const ZERO: Totals = {
  income: 0,
  fixed: 0,
  variable: 0,
  savings: 0,
  spent: 0,
  leftover: 0,
};

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildInsightsPage(
  lines: Line[],
  month: string,
  today: string,
  opts: { avgMonths?: AvgMonths } = {},
): InsightsPage {
  const avgMonths = opts.avgMonths ?? 3;
  const months = [...new Set([...dataMonths(lines), month])].sort();
  const current = today.slice(0, 7);
  const complete = completeMonths(dataMonths(lines), current).filter(
    (m) => m < month,
  );
  const avgWindow = complete.slice(-avgMonths);
  const totals = monthTotals(lines);
  const historyMonths = Array.from({ length: 6 }, (_, i) =>
    shiftMonth(month, i - 5),
  );
  const t = totals.get(month) ?? ZERO;
  // The month in progress is only fair to compare with the same stretch of
  // the month before it; a finished month compares whole to whole.
  const isCurrent = month === current;
  const prev = shiftMonth(month, -1);
  const lastTotals = isCurrent
    ? monthTotalsThrough(lines, prev, Number(today.slice(8, 10)))
    : (totals.get(prev) ?? ZERO);
  return {
    month,
    months,
    totals: t,
    lastTotals,
    avgWindow,
    avgMonths,
    partialComparison: isCurrent,
    breakdown: categoryBreakdown(lines, month, avgWindow),
    waterfall: waterfallSteps(t),
    history: cashFlowHistory(lines, historyMonths),
    topByDollars: topMerchants(lines, month, "dollars"),
    topByCount: topMerchants(lines, month, "count"),
  };
}
