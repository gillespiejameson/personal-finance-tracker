import { bucketOf } from "@/lib/insights/aggregate";
import type { Line } from "@/lib/insights/lines";
import { shiftMonth } from "@/lib/insights/page";

export function leafSpendByMonth(
  lines: Line[],
): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  for (const l of lines) {
    if (l.categoryId === null || bucketOf(l) === "income") continue;
    const m = out.get(l.categoryId) ?? new Map<string, number>();
    m.set(l.month, (m.get(l.month) ?? 0) - l.amountCents);
    out.set(l.categoryId, m);
  }
  return out;
}

/**
 * Walk from the leaf's earliest budget row up to `month`; a month without a
 * row resets the chain back to 0 carry. See `setBudgetRow` — a 0 amount
 * deletes the row for that month, which is exactly what triggers this reset.
 */
export function carryFor(o: {
  rows: Map<string, number>;
  spent: Map<string, number>;
  rollover: boolean;
  month: string;
}): number {
  if (!o.rollover || o.rows.size === 0) return 0;
  const first = [...o.rows.keys()].sort()[0];
  if (o.month <= first) return 0;
  let carry = 0;
  let m = first;
  while (m < o.month) {
    const budgeted = o.rows.get(m);
    carry =
      budgeted === undefined ? 0 : budgeted + carry - (o.spent.get(m) ?? 0);
    m = shiftMonth(m, 1);
  }
  return carry;
}
