import type { Bill } from "@/lib/recurring/refresh";
import {
  accrued,
  monthlyShare,
  nextDue,
  periodMonths,
  previousDue,
} from "./math";
import type {
  Every,
  IrregularItem,
  PlannedExpense,
  SpreadByLeaf,
} from "./types";

type LeafRef = { id: number; name: string; color: string };

/** Later of two ISO `YYYY-MM-DD` dates (lexicographic order is date order). */
function maxIsoDate(a: string, b: string): string {
  return a > b ? a : b;
}

export function irregularItems(i: {
  bills: Bill[];
  planned: PlannedExpense[];
  today: string;
  leaves: LeafRef[];
}): IrregularItem[] {
  const leafById = new Map(i.leaves.map((l) => [l.id, l]));
  const fromBills: IrregularItem[] = i.bills
    .filter(
      (b) =>
        b.active &&
        !b.dismissed &&
        !b.isIncome &&
        (b.cadence === "quarterly" || b.cadence === "annual"),
    )
    .map((b) => {
      const every: Every = b.cadence === "quarterly" ? "quarter" : "year";
      const months = every === "quarter" ? 3 : 12;
      const amountCents = Math.abs(b.avgCents);
      const monthlyCents = monthlyShare(amountCents, months);
      const prev = previousDue(every, b.nextExpected, months);
      return {
        key: `bill:${b.id}`,
        source: "bill" as const,
        id: b.id,
        name: b.merchant,
        amountCents,
        every,
        nextDue: b.nextExpected,
        periodMonths: months,
        monthlyCents,
        accruedCents: accrued({
          amountCents,
          monthlyCents,
          previousDue: prev,
          today: i.today,
        }),
        categoryId: b.categoryId,
        categoryName: b.categoryName,
        color: b.color,
      };
    });
  const fromPlanned: IrregularItem[] = i.planned
    .filter((p) => !p.archived)
    .map((p) => {
      // `createdAt` is a full timestamp; only the date part feeds the
      // (date-only) accrual math.
      const createdDate = p.createdAt.slice(0, 10);
      const months = periodMonths(p.every, createdDate, p.dueDate);
      const monthlyCents = monthlyShare(p.amountCents, months);
      const next = nextDue(p.every, p.dueDate, i.today);
      // "once" accrues from the moment the expense was planned, not from a
      // recurring cycle boundary; year/quarter accrue from the cycle before
      // whichever occurrence is next (or the due date itself, which is the
      // same thing, when nextDue hasn't shifted yet) — but never from
      // before the item existed, so a freshly created item starts at $0.
      const prev =
        p.every === "once"
          ? createdDate
          : maxIsoDate(
              previousDue(p.every, next ?? p.dueDate, months),
              createdDate,
            );
      const leaf =
        p.categoryId !== null ? leafById.get(p.categoryId) : undefined;
      return {
        key: `planned:${p.id}`,
        source: "planned" as const,
        id: p.id,
        name: p.name,
        amountCents: p.amountCents,
        every: p.every,
        nextDue: next,
        periodMonths: months,
        monthlyCents,
        accruedCents: accrued({
          amountCents: p.amountCents,
          monthlyCents,
          previousDue: prev,
          today: i.today,
        }),
        categoryId: p.categoryId,
        categoryName: leaf?.name ?? null,
        color: leaf?.color ?? null,
        planned: p,
      };
    });
  return [...fromBills, ...fromPlanned].sort((a, b) => {
    if (a.nextDue === null && b.nextDue === null)
      return a.name.localeCompare(b.name);
    if (a.nextDue === null) return 1;
    if (b.nextDue === null) return -1;
    return a.nextDue.localeCompare(b.nextDue) || a.name.localeCompare(b.name);
  });
}

export function spreadByLeaf(
  items: IrregularItem[],
  opts: { source?: "planned" } = {},
): SpreadByLeaf {
  const map: SpreadByLeaf = new Map();
  for (const item of items) {
    if (item.categoryId === null) continue;
    if (opts.source !== undefined && item.source !== opts.source) continue;
    const entry = map.get(item.categoryId) ?? { cents: 0, names: [] };
    entry.cents += item.monthlyCents;
    entry.names.push(item.name);
    map.set(item.categoryId, entry);
  }
  return map;
}
