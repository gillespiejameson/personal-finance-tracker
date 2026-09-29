import { addDays, monthEnd, monthOf } from "@/lib/dates";
import { shiftMonth } from "@/lib/insights/page";
import type { Cadence } from "@/lib/recurring/detect";
import type { Bill } from "@/lib/recurring/refresh";
import type { IrregularItem } from "@/lib/spreading/types";
import type { ForecastEvent } from "./types";

/** Day-of-month clamp: the last day of `month` if `day` overshoots it. */
function clampToMonth(month: string, day: number): string {
  const lastDay = Number(monthEnd(month).slice(8, 10));
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

type Step = { kind: "days"; n: number } | { kind: "months"; n: number };

/** Exhaustive over `Cadence` — an unrecognized value throws rather than
 * silently stepping by zero, which would make `occurrences`' `while` loop
 * spin forever (the candidate date would never advance past `to`). */
function stepFor(cadence: Cadence): Step {
  switch (cadence) {
    case "weekly":
      return { kind: "days", n: 7 };
    case "biweekly":
      return { kind: "days", n: 14 };
    case "monthly":
      return { kind: "months", n: 1 };
    case "quarterly":
      return { kind: "months", n: 3 };
    case "annual":
      return { kind: "months", n: 12 };
    default: {
      const exhaustive: never = cadence;
      throw new Error(`Unknown cadence: ${String(exhaustive)}`);
    }
  }
}

/**
 * Dates of `start`, `start + 1 cadence`, `start + 2 cadences`, … that fall
 * inside `(from, to]`. Weekly/biweekly step by fixed day counts. Monthly/
 * quarterly/annual step by calendar months from `start`'s own month (never
 * compounding off a clamped date), clamping each result's day-of-month to
 * the target month's length — so Aug 31 monthly recovers day 31 in a
 * 31-day month even after landing on Sep 30.
 */
export function occurrences(
  start: string,
  cadence: Cadence,
  from: string,
  to: string,
): string[] {
  const step = stepFor(cadence);
  const startMonth = monthOf(start);
  const day = Number(start.slice(8, 10));
  const dates: string[] = [];
  let candidate = start;
  let n = 0;
  while (candidate <= to) {
    if (candidate > from) dates.push(candidate);
    n++;
    candidate =
      step.kind === "days"
        ? addDays(start, step.n * n)
        : clampToMonth(shiftMonth(startMonth, step.n * n), day);
  }
  return dates;
}

function sortEvents(events: ForecastEvent[]): ForecastEvent[] {
  return [...events].sort((a, b) =>
    a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1,
  );
}

/**
 * Dated cash movements inside `(today, today + days]` from active,
 * non-dismissed recurring bills (income and expense) and irregular planned
 * expenses. A bill overdue or due today as of today (`nextExpected <=
 * today`) is still coming, so a single catch-up occurrence is placed on
 * `today + 1`. Later occurrences are not re-anchored to that catch-up date —
 * they keep stepping by cadence from the bill's original `nextExpected`
 * (filtered to dates after `today + 1`), so e.g. a monthly bill due on the
 * 25th keeps recurring on the 25th instead of drifting onto whatever day of
 * the month the catch-up landed on.
 */
export function forecastEvents(i: {
  bills: Bill[];
  planned: IrregularItem[];
  today: string;
  days: number;
}): ForecastEvent[] {
  const { bills, planned, today, days } = i;
  const to = addDays(today, days);
  const events: ForecastEvent[] = [];

  for (const b of bills) {
    if (!b.active || b.dismissed) continue;
    const amountCents = b.isIncome
      ? Math.abs(b.avgCents)
      : -Math.abs(b.avgCents);
    const overdueOrToday = b.nextExpected <= today;
    const dates: string[] = [];
    if (overdueOrToday) {
      const catchUp = addDays(today, 1);
      if (catchUp <= to) dates.push(catchUp);
      dates.push(...occurrences(b.nextExpected, b.cadence, catchUp, to));
    } else {
      dates.push(...occurrences(b.nextExpected, b.cadence, today, to));
    }
    for (const date of dates) {
      events.push({
        date,
        name: b.merchant,
        amountCents,
        kind: b.isIncome ? "income" : "bill",
      });
    }
  }

  for (const p of planned) {
    if (!p.nextDue) continue;
    const amountCents = -Math.abs(p.amountCents);
    if (p.every === "once") {
      if (p.nextDue > today && p.nextDue <= to) {
        events.push({
          date: p.nextDue,
          name: p.name,
          amountCents,
          kind: "planned",
        });
      }
      continue;
    }
    const cadence: Cadence = p.every === "quarter" ? "quarterly" : "annual";
    for (const date of occurrences(p.nextDue, cadence, today, to)) {
      events.push({ date, name: p.name, amountCents, kind: "planned" });
    }
  }

  return sortEvents(events);
}
