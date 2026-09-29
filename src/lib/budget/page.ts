import { addDays, daysBetween, monthEnd } from "@/lib/dates";
import { bucketOf } from "@/lib/insights/aggregate";
import type { Line } from "@/lib/insights/lines";
import { shiftMonth } from "@/lib/insights/page";
import type { Bill } from "@/lib/recurring/refresh";
import type { IrregularItem, SpreadByLeaf } from "@/lib/spreading/types";
import { carryFor, leafSpendByMonth } from "./rollover";
import { safeToSpend } from "./safeToSpend";
import type {
  BudgetGroup,
  BudgetLeaf,
  BudgetPage,
  BudgetRow,
  Gate,
  LeafMeta,
  ResolvedPayday,
  Status,
  Strip,
} from "./types";

export const WARN_FRACTION = 0.85;

function status(spent: number, available: number, remaining: number): Status {
  if (remaining < 0) return "over";
  if (available > 0 && spent >= WARN_FRACTION * available) return "warn";
  return "ok";
}

/** Unposted, non-income bills expected before `bound` (exclusive), skipping
 *  fixed leaves — their own budget line already reserves the money. */
function unpostedBillsBefore(
  bills: Bill[],
  bound: string,
  fixedLeafIds: Set<number>,
): number {
  return bills
    .filter(
      (b) =>
        b.active &&
        !b.dismissed &&
        !b.isIncome &&
        b.nextExpected < bound &&
        !(b.categoryId !== null && fixedLeafIds.has(b.categoryId)),
    )
    .reduce((s, b) => s + Math.abs(b.avgCents), 0);
}

export function buildBudgetPage(i: {
  lines: Line[];
  leaves: LeafMeta[];
  rows: BudgetRow[];
  incomeCents: number | null;
  bills: Bill[];
  spread: SpreadByLeaf;
  setAside: IrregularItem[];
  month: string;
  today: string;
  payday: ResolvedPayday;
  gate: Gate;
  dataMonths: string[];
}): BudgetPage {
  const { month, today } = i;
  const current = today.slice(0, 7);
  const isCurrent = month === current;
  const rowsByLeaf = new Map<number, Map<string, number>>();
  for (const r of i.rows) {
    const m = rowsByLeaf.get(r.categoryId) ?? new Map<string, number>();
    m.set(r.month, r.amountCents);
    rowsByLeaf.set(r.categoryId, m);
  }
  const budgetMonths = new Set(i.rows.map((r) => r.month));
  const spendByLeaf = leafSpendByMonth(i.lines);
  const leafRows: BudgetLeaf[] = i.leaves.map((leaf) => {
    const rows = rowsByLeaf.get(leaf.id) ?? new Map<string, number>();
    const spentMap = spendByLeaf.get(leaf.id) ?? new Map<string, number>();
    const hasRow = rows.has(month);
    const budgeted = rows.get(month) ?? 0;
    const carry = hasRow
      ? carryFor({ rows, spent: spentMap, rollover: leaf.rollover, month })
      : 0;
    const spent = spentMap.get(month) ?? 0;
    const available = budgeted + carry;
    const remaining = available - spent;
    const st = status(spent, available, remaining);
    const fill =
      st === "over"
        ? 1
        : available > 0
          ? Math.min(1, Math.max(0, spent / available))
          : 0;
    const spreadEntry = i.spread.get(leaf.id);
    return {
      id: leaf.id,
      name: leaf.name,
      color: leaf.color,
      parentId: leaf.parentId,
      parentName: leaf.parentName,
      isFixed: leaf.isFixed,
      isSavings: leaf.isSavings,
      rollover: leaf.rollover,
      goalId: leaf.goalId,
      budgeted,
      carry,
      available,
      spent,
      remaining,
      status: st,
      fill,
      hasRow,
      setAside: spreadEntry
        ? { cents: spreadEntry.cents, names: spreadEntry.names }
        : null,
    };
  });
  const budgetedLeaves = leafRows.filter((l) => l.hasRow);
  const overspent = budgetedLeaves.filter((l) => l.status === "over");
  const unbudgeted = leafRows.filter((l) => !l.hasRow && l.spent !== 0);
  const order = new Map(i.leaves.map((l) => [l.id, l]));
  // Groups are built from every budgeted leaf, over-budget included, so a
  // parent's subtotal is honest and the parent never disappears just because
  // one of its leaves went over. `overspent` (above) still lists the over
  // leaves separately for the pinned summary.
  const byParent = new Map<number, BudgetLeaf[]>();
  for (const l of budgetedLeaves) {
    byParent.set(l.parentId, [...(byParent.get(l.parentId) ?? []), l]);
  }
  const groups: BudgetGroup[] = [...byParent.entries()]
    .map(([parentId, leaves]) => {
      const sorted = leaves.sort(
        (a, b) => (order.get(a.id)?.sort ?? 0) - (order.get(b.id)?.sort ?? 0),
      );
      return {
        parentId,
        parentName: sorted[0].parentName,
        color: sorted[0].color,
        leaves: sorted,
        budgeted: sorted.reduce((s, l) => s + l.budgeted, 0),
        spent: sorted.reduce((s, l) => s + l.spent, 0),
        remaining: sorted.reduce((s, l) => s + l.remaining, 0),
      };
    })
    .sort(
      (a, b) =>
        (order.get(a.leaves[0].id)?.parentSort ?? 0) -
        (order.get(b.leaves[0].id)?.parentSort ?? 0),
    );
  const uncategorizedCents = i.lines
    .filter(
      (l) =>
        l.month === month && l.categoryId === null && bucketOf(l) !== "income",
    )
    .reduce((s, l) => s - l.amountCents, 0);
  const assignedCents = budgetedLeaves.reduce((s, l) => s + l.budgeted, 0);
  const incomeCents = i.incomeCents ?? 0;
  const needs = budgetedLeaves
    .filter((l) => l.isFixed && !l.isSavings)
    .reduce((s, l) => s + l.budgeted, 0);
  const save = budgetedLeaves
    .filter((l) => l.isSavings)
    .reduce((s, l) => s + l.budgeted, 0);
  const wants = assignedCents - needs - save;
  const pct = (n: number) => (incomeCents > 0 ? n / incomeCents : 0);
  const strip: Strip = {
    needs,
    wants,
    save,
    needsPct: pct(needs),
    wantsPct: pct(wants),
    savePct: pct(save),
  };
  let safe: BudgetPage["safeToSpend"] = null;
  if (isCurrent && budgetedLeaves.length > 0) {
    const horizonKind = i.payday ? "payday" : "monthEnd";
    const end = monthEnd(month);
    const endBound = addDays(end, 1); // bills due on the last day still count
    const endDays = daysBetween(today, end) + 1;
    const horizon = i.payday ? i.payday.next : end;
    const bound = i.payday ? horizon : endBound;
    const daysUntil = i.payday ? i.payday.daysUntil : endDays;
    const fixedLeafIds = new Set(
      i.leaves.filter((l) => l.isFixed).map((l) => l.id),
    );
    const variableRemainingCents = budgetedLeaves
      .filter((l) => !l.isFixed && !l.isSavings)
      .reduce((s, l) => s + l.remaining, 0);
    safe = safeToSpend({
      variableRemainingCents,
      unpostedBillsCents: unpostedBillsBefore(i.bills, bound, fixedLeafIds),
      daysUntil,
      horizon,
      horizonKind,
      restOfMonth: i.payday
        ? {
            unpostedBillsCents: unpostedBillsBefore(
              i.bills,
              endBound,
              fixedLeafIds,
            ),
            daysUntil: endDays,
            horizon: end,
          }
        : undefined,
    });
  }
  const months = [
    ...new Set([...i.dataMonths, ...budgetMonths, current]),
  ].sort();
  return {
    month,
    months,
    today,
    isCurrent,
    gate: i.gate,
    hasBudget: budgetedLeaves.length > 0,
    prevHasBudget: budgetMonths.has(shiftMonth(month, -1)),
    nextHasBudget: budgetMonths.has(shiftMonth(month, 1)),
    incomeCents,
    assignedCents,
    leftToAssignCents: incomeCents - assignedCents,
    budgetedCents: assignedCents,
    // Spend in categorized, non-savings leaves (budgeted or not). Adding the
    // month's uncategorized spend gives exactly Insights' `totals.spent`.
    spentCents:
      budgetedLeaves
        .filter((l) => !l.isSavings)
        .reduce((s, l) => s + l.spent, 0) +
      unbudgeted.filter((l) => !l.isSavings).reduce((s, l) => s + l.spent, 0),
    strip,
    groups,
    overspent,
    unbudgeted,
    uncategorizedCents,
    safeToSpend: safe,
    payday: i.payday,
    setAside: i.setAside,
  };
}
