import { addDays, monthEnd, monthOf } from "@/lib/dates";
import type { ForecastEvent, ForecastPoint, SpendRate } from "./types";

/** Number of days in `month` (a "YYYY-MM" string). */
function daysInMonth(month: string): number {
  return Number(monthEnd(month).slice(8, 10));
}

/** Account types counted as spendable cash for the forecast's starting balance. */
export const CASH_TYPES = new Set(["checking", "savings", "cash"]);

/** Σ latest balances of checking/savings/cash accounts with a snapshot. */
export function startingCash(
  balances: { type: string; balanceCents: number | null }[],
): number {
  return balances
    .filter((b) => CASH_TYPES.has(b.type) && b.balanceCents !== null)
    .reduce((sum, b) => sum + (b.balanceCents ?? 0), 0);
}

/**
 * Daily balance from today through `today + days`. `points[0]` is today at
 * `startCents` with no events (today's spend is assumed already reflected
 * in the starting balance). Each later day applies that day's events first,
 * then subtracts the daily spend rate for the month it falls in.
 */
export function forecastSeries(i: {
  startCents: number;
  today: string;
  days: number;
  events: ForecastEvent[];
  rate: SpendRate;
}): ForecastPoint[] {
  const { startCents, today, days, events, rate } = i;
  const todayMonth = monthOf(today);
  const byDate = new Map<string, ForecastEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }

  const points: ForecastPoint[] = [
    { date: today, balanceCents: startCents, events: [] },
  ];
  let balance = startCents;
  for (let d = 1; d <= days; d++) {
    const date = addDays(today, d);
    const dayEvents = byDate.get(date) ?? [];
    for (const e of dayEvents) balance += e.amountCents;
    const month = monthOf(date);
    balance -=
      month === todayMonth
        ? rate.thisMonthDailyCents
        : Math.round(rate.laterMonthlyCents / daysInMonth(month));
    points.push({ date, balanceCents: balance, events: dayEvents });
  }
  return points;
}

export function summarize(
  points: ForecastPoint[],
  floorCents: number,
): {
  lowestCents: number;
  lowestDate: string;
  endCents: number;
  endDate: string;
  belowFloorOn: string | null;
  shortByCents: number;
  shortAtBreachCents: number;
} {
  let lowestCents = points[0].balanceCents;
  let lowestDate = points[0].date;
  let belowFloorOn: string | null = null;
  let shortAtBreachCents = 0;
  for (const p of points) {
    if (p.balanceCents < lowestCents) {
      lowestCents = p.balanceCents;
      lowestDate = p.date;
    }
    if (belowFloorOn === null && p.balanceCents < floorCents) {
      belowFloorOn = p.date;
      shortAtBreachCents = floorCents - p.balanceCents;
    }
  }
  const last = points[points.length - 1];
  return {
    lowestCents,
    lowestDate,
    endCents: last.balanceCents,
    endDate: last.date,
    belowFloorOn,
    shortByCents: Math.max(0, floorCents - lowestCents),
    shortAtBreachCents,
  };
}
