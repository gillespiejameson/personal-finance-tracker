import { PARENT_COLORS } from "@/lib/categories/palette";
import { monthEnd } from "@/lib/dates";
import type { Line } from "./lines";

export type Bucket = "income" | "fixed" | "variable" | "savings";
export const SAVINGS_SEED_KEY = "savings/savings-investing";
export const SAVINGS_PARENT_KEY = "savings";
export const UNCATEGORIZED = {
  parentName: "Uncategorized",
  leafName: "Uncategorized",
  color: PARENT_COLORS.uncategorized,
};

export function bucketOf(line: Line): Bucket {
  if (line.parentKind === "income") return "income";
  if (line.categoryId === null)
    return line.amountCents > 0 ? "income" : "variable";
  if (
    line.parentSeedKey === SAVINGS_PARENT_KEY ||
    line.leafSeedKey === SAVINGS_SEED_KEY
  )
    return "savings";
  return line.isFixed ? "fixed" : "variable";
}

/** Signed contribution: income adds the amount; spend buckets add −amount (refunds subtract). */
export function contribution(line: Line): { bucket: Bucket; cents: number } {
  const bucket = bucketOf(line);
  return {
    bucket,
    cents: bucket === "income" ? line.amountCents : -line.amountCents,
  };
}

export type Totals = {
  income: number;
  fixed: number;
  variable: number;
  savings: number;
  spent: number;
  leftover: number;
};
const empty = (): Totals => ({
  income: 0,
  fixed: 0,
  variable: 0,
  savings: 0,
  spent: 0,
  leftover: 0,
});

export function monthTotals(lines: Line[]): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const l of lines) {
    const t = out.get(l.month) ?? empty();
    const { bucket, cents } = contribution(l);
    t[bucket] += cents;
    out.set(l.month, t);
  }
  for (const t of out.values()) {
    // `spent` excludes savings; see `categoryBreakdown` for the all-outflows share base.
    t.spent = t.fixed + t.variable;
    t.leftover = t.income - t.fixed - t.variable - t.savings;
  }
  return out;
}

/**
 * Totals for `month` counting only days 1..`day` (clamped to the month's
 * length), so a partial current month can be compared with the same stretch
 * of the month before it.
 */
export function monthTotalsThrough(
  lines: Line[],
  month: string,
  day: number,
): Totals {
  const last = Number(monthEnd(month).slice(8, 10));
  const cutoff = `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
  return (
    monthTotals(lines.filter((l) => l.month === month && l.date <= cutoff)).get(
      month,
    ) ?? empty()
  );
}

export function dataMonths(
  lines: Line[],
  opts: { minRows?: number } = {},
): string[] {
  const min = opts.minRows ?? 20;
  const counts = new Map<string, Set<number>>();
  for (const l of lines)
    counts.set(l.month, (counts.get(l.month) ?? new Set()).add(l.txnId));
  return [...counts.entries()]
    .filter(([, s]) => s.size >= min)
    .map(([m]) => m)
    .sort();
}

export function completeMonths(
  months: string[],
  currentMonth: string,
): string[] {
  return months.filter((m) => m < currentMonth);
}

export type CategoryRow = {
  id: number | null;
  name: string;
  color: string;
  isFixed: boolean;
  thisMonth: number;
  lastMonth: number;
  avg: number;
  avgMonths: number;
  share: number;
  leaves?: CategoryRow[];
};

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Share is a fraction of `spent` (fixed + variable) this month, so the donut
 * and table agree with `Totals.spent` everywhere else in Insights. Savings is
 * shown separately (strip/waterfall/history) and never appears as a row here.
 */
export function categoryBreakdown(
  lines: Line[],
  month: string,
  avgWindow: string[],
): CategoryRow[] {
  const spendLines = lines.filter(
    (l) => bucketOf(l) !== "income" && bucketOf(l) !== "savings",
  );
  const last = prevMonth(month);
  const windowSet = new Set(avgWindow);
  type Acc = {
    id: number | null;
    name: string;
    color: string;
    isFixed: boolean;
    thisMonth: number;
    lastMonth: number;
    windowSum: number;
    leaves: Map<string, Acc>;
  };
  const parents = new Map<string, Acc>();
  const acc = (
    map: Map<string, Acc>,
    key: string,
    init: Omit<Acc, "thisMonth" | "lastMonth" | "windowSum" | "leaves">,
  ) => {
    const a = map.get(key) ?? {
      ...init,
      thisMonth: 0,
      lastMonth: 0,
      windowSum: 0,
      leaves: new Map(),
    };
    map.set(key, a);
    return a;
  };
  for (const l of spendLines) {
    const cents = -l.amountCents;
    const p = acc(parents, l.parentName, {
      id: l.parentId ?? null,
      name: l.parentName,
      color: l.color,
      isFixed: l.isFixed,
    });
    const leaf = acc(p.leaves, l.leafName, {
      id: l.categoryId,
      name: l.leafName,
      color: l.color,
      isFixed: l.isFixed,
    });
    for (const a of [p, leaf]) {
      if (l.month === month) a.thisMonth += cents;
      if (l.month === last) a.lastMonth += cents;
      if (windowSet.has(l.month)) a.windowSum += cents;
    }
  }
  acc(parents, UNCATEGORIZED.parentName, {
    id: null,
    name: UNCATEGORIZED.parentName,
    color: UNCATEGORIZED.color,
    isFixed: false,
  });
  const total = [...parents.values()].reduce((s, p) => s + p.thisMonth, 0);
  const n = avgWindow.length;
  // Leaves are seeded with their parent's color, so `l.color` is valid at both levels.
  const toRow = (a: Acc, withLeaves: boolean): CategoryRow => ({
    id: a.id,
    name: a.name,
    color: a.color,
    isFixed: a.isFixed,
    thisMonth: a.thisMonth,
    lastMonth: a.lastMonth,
    avg: n ? Math.round(a.windowSum / n) : 0,
    avgMonths: n,
    share: total ? a.thisMonth / total : 0,
    ...(withLeaves
      ? {
          leaves: [...a.leaves.values()]
            .map((l) => toRow(l, false))
            .sort((x, y) => y.thisMonth - x.thisMonth),
        }
      : {}),
  });
  const rows = [...parents.values()]
    .filter((p) => p.name !== UNCATEGORIZED.parentName)
    .map((p) => toRow(p, true))
    .sort((x, y) => y.thisMonth - x.thisMonth);
  const unc = parents.get(UNCATEGORIZED.parentName);
  if (unc) rows.push(toRow(unc, false));
  return rows;
}
