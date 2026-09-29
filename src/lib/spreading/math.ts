import { monthEnd, monthOf } from "@/lib/dates";
import { shiftMonth } from "@/lib/insights/page";
import type { Every } from "./types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `${month}-${day}`, with `day` clamped to the last day of `month`. */
function clampToMonth(month: string, day: number): string {
  const end = monthEnd(month);
  const lastDay = Number(end.slice(8, 10));
  return `${month}-${pad(Math.min(day, lastDay))}`;
}

export function periodMonths(
  every: Every,
  createdAt: string,
  dueDate: string,
): number {
  if (every === "year") return 12;
  if (every === "quarter") return 3;
  const [cy, cm] = createdAt.slice(0, 10).split("-").map(Number);
  const [dy, dm] = dueDate.slice(0, 10).split("-").map(Number);
  return Math.max(1, dy * 12 + dm - (cy * 12 + cm));
}

export function nextDue(
  every: Every,
  dueDate: string,
  today: string,
): string | null {
  if (every === "once") return dueDate >= today ? dueDate : null;
  if (every === "quarter") {
    const day = Number(dueDate.slice(8, 10));
    let month = monthOf(dueDate);
    let candidate = dueDate;
    while (candidate < today) {
      month = shiftMonth(month, 3);
      candidate = clampToMonth(month, day);
    }
    return candidate;
  }
  // year: the anniversary (month/day) on/after today, walking forward one
  // year at a time from the due date's own year (never backward past it).
  const month = dueDate.slice(5, 7);
  const day = Number(dueDate.slice(8, 10));
  let year = Number(dueDate.slice(0, 4));
  let candidate = clampToMonth(`${year}-${month}`, day);
  while (candidate < today) {
    year++;
    candidate = clampToMonth(`${year}-${month}`, day);
  }
  return candidate;
}

export function previousDue(
  _every: Every,
  next: string,
  months: number,
): string {
  const month = shiftMonth(monthOf(next), -months);
  const day = Number(next.slice(8, 10));
  return clampToMonth(month, day);
}

export function monthlyShare(amountCents: number, months: number): number {
  return Math.round(amountCents / months);
}

/**
 * Whole calendar months elapsed from `previousDue` to `today`, times
 * `monthlyCents`, capped at `amountCents`. "Whole" means the day-of-month
 * matters: a month only counts once today's day-of-month reaches (or
 * passes) `previousDue`'s day-of-month in that month, so accrual reaches
 * 100% exactly when `today` reaches the item's next due date (never before).
 */
export function accrued(i: {
  amountCents: number;
  monthlyCents: number;
  previousDue: string;
  today: string;
}): number {
  const [py, pm, pd] = i.previousDue.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = i.today.slice(0, 10).split("-").map(Number);
  const months = Math.max(0, ty * 12 + tm - (py * 12 + pm) - (td < pd ? 1 : 0));
  return Math.min(i.amountCents, months * i.monthlyCents);
}
