import type { Line } from "@/lib/insights/lines";
import { shiftMonth } from "@/lib/insights/page";
import type { Bill } from "@/lib/recurring/refresh";
import type { SpreadByLeaf } from "@/lib/spreading/types";
import { leafSpendByMonth } from "./rollover";
import type { LeafMeta, SetupPage, SetupRow } from "./types";

export function roundUp10(cents: number): number {
  return cents <= 0 ? 0 : Math.ceil(cents / 1000) * 1000;
}

export function setupDefaults(i: {
  lines: Line[];
  leaves: LeafMeta[];
  bills: Bill[];
  planned: SpreadByLeaf;
  month: string;
  avgWindow: string[];
  goalNeeded: Map<number, number>;
  expectedIncomeFallback: number;
}): SetupPage {
  const n = i.avgWindow.length;
  const spend = leafSpendByMonth(i.lines);
  const last = shiftMonth(i.month, -1);
  // Bills floor the suggestion for fixed leaves. A "likely" pair (two
  // identical charges, no third yet) is not evidence enough to raise a budget
  // line; the forecast and spreading views may still show it.
  const billsByLeaf = new Map<number, number>();
  for (const b of i.bills)
    if (
      b.active &&
      !b.dismissed &&
      !b.isIncome &&
      b.confidence !== "likely" &&
      b.categoryId !== null
    )
      billsByLeaf.set(
        b.categoryId,
        (billsByLeaf.get(b.categoryId) ?? 0) + b.monthlyCents,
      );
  const rows: SetupRow[] = i.leaves.map((leaf) => {
    const byMonth = spend.get(leaf.id) ?? new Map<string, number>();
    const avg =
      n === 0
        ? 0
        : Math.round(
            i.avgWindow.reduce((s, m) => s + (byMonth.get(m) ?? 0), 0) / n,
          );
    const billsCents = billsByLeaf.get(leaf.id) ?? 0;
    const plannedEntry = i.planned.get(leaf.id);
    const plannedCents = plannedEntry?.cents ?? 0;
    const plannedNames = plannedEntry?.names ?? [];
    const goal =
      leaf.goalId === null ? undefined : i.goalNeeded.get(leaf.goalId);
    const suggested =
      goal !== undefined
        ? goal
        : leaf.isFixed
          ? roundUp10(Math.max(avg, billsCents + plannedCents))
          : roundUp10(Math.max(avg, plannedCents));
    return {
      categoryId: leaf.id,
      name: leaf.name,
      parentId: leaf.parentId,
      parentName: leaf.parentName,
      color: leaf.color,
      isFixed: leaf.isFixed,
      isSavings: leaf.isSavings,
      goalId: leaf.goalId,
      avgCents: Math.max(0, avg),
      lastMonthCents: Math.max(0, byMonth.get(last) ?? 0),
      billsCents,
      plannedCents,
      plannedNames,
      suggestedCents: Math.max(0, suggested),
      hasHistory:
        byMonth.size > 0 ||
        billsCents > 0 ||
        plannedCents > 0 ||
        goal !== undefined,
    };
  });
  // Only lines actually categorized under an income parent count as income —
  // an uncategorized positive deposit is not assumed to be a paycheck, so it
  // must not inflate the default. It's surfaced separately below instead.
  const income =
    n === 0
      ? i.expectedIncomeFallback
      : Math.round(
          i.lines
            .filter(
              (l) =>
                i.avgWindow.includes(l.month) &&
                l.categoryId !== null &&
                l.parentKind === "income",
            )
            .reduce((s, l) => s + l.amountCents, 0) / n,
        );
  const uncategorizedIncomeCents =
    n === 0
      ? 0
      : Math.round(
          i.lines
            .filter(
              (l) =>
                i.avgWindow.includes(l.month) &&
                l.categoryId === null &&
                l.amountCents > 0,
            )
            .reduce((s, l) => s + l.amountCents, 0) / n,
        );
  const uncategorizedSpendCents =
    n === 0
      ? 0
      : Math.round(
          i.lines
            .filter(
              (l) =>
                i.avgWindow.includes(l.month) &&
                l.categoryId === null &&
                l.amountCents < 0,
            )
            .reduce((s, l) => s - l.amountCents, 0) / n,
        );
  return {
    month: i.month,
    incomeCents: Math.max(0, income),
    uncategorizedIncomeCents: Math.max(0, uncategorizedIncomeCents),
    uncategorizedSpendCents: Math.max(0, uncategorizedSpendCents),
    avgMonths: n,
    rows,
  };
}
