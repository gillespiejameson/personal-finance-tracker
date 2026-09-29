import type { BudgetPage } from "@/lib/budget/types";
import { daysBetween, monthEnd } from "@/lib/dates";
import type { Bill } from "@/lib/recurring/refresh";
import type { ReviewStatus } from "@/lib/ritual/types";
import type { IrregularItem } from "@/lib/spreading/types";
import type { WallSummary } from "./types";

type BudgetInput = Pick<
  BudgetPage,
  | "month"
  | "gate"
  | "hasBudget"
  | "spentCents"
  | "budgetedCents"
  | "safeToSpend"
>;

/** Same rule as the weekly review's step 4: overdue first, then due within 7 days. */
function dueBills(bills: Bill[], today: string): WallSummary["bills"]["due"] {
  return bills
    .filter((b) => b.active && !b.dismissed && !b.isIncome)
    .map((b) => ({
      name: b.merchant,
      cents: b.avgCents,
      expectedDate: b.nextExpected,
      overdue: b.nextExpected < today,
      categoryColor: b.color,
      dueInDays: b.dueInDays,
    }))
    .filter((b) => b.overdue || (b.dueInDays >= 0 && b.dueInDays <= 7))
    .sort((a, b) =>
      a.overdue !== b.overdue
        ? a.overdue
          ? -1
          : 1
        : a.expectedDate.localeCompare(b.expectedDate),
    )
    .map(({ dueInDays: _drop, ...rest }) => rest);
}

function elapsedShare(month: string, today: string): number {
  const start = `${month}-01`;
  const days = daysBetween(start, monthEnd(month)) + 1;
  const elapsed = daysBetween(start, today) + 1;
  return Math.min(1, Math.max(0, elapsed / days));
}

/** The glanceable numbers, assembled from the loaders Home, Budget, Bills and the weekly review already use. */
export function buildWallSummary(i: {
  today: string;
  now: Date;
  budget: BudgetInput;
  bills: Bill[];
  reviewCount: number;
  review: ReviewStatus;
  items: IrregularItem[];
  alertCount: number;
}): WallSummary {
  const safe = i.budget.safeToSpend;
  const due = dueBills(i.bills, i.today);
  const planned = i.items
    .filter(
      (x): x is IrregularItem & { nextDue: string } =>
        x.source === "planned" && x.nextDue !== null,
    )
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue))[0];
  return {
    generatedAt: i.now.toISOString(),
    today: i.today,
    gateOpen: i.budget.gate.open,
    safeToSpend: safe
      ? {
          perDayCents: safe.perDayCents,
          totalCents: safe.totalCents,
          untilDate: safe.horizon,
          horizonLabel:
            safe.horizonKind === "payday" ? "until payday" : "until month end",
        }
      : null,
    bills: {
      due,
      dueTotalCents: due.reduce((s, b) => s + Math.abs(b.cents), 0),
    },
    review: {
      count: i.reviewCount,
      streakWeeks: i.review.streak,
      weeklyDue: i.review.due,
    },
    budget:
      i.budget.gate.open && i.budget.hasBudget
        ? {
            month: i.budget.month,
            spentCents: i.budget.spentCents,
            budgetedCents: i.budget.budgetedCents,
            elapsedShare: elapsedShare(i.budget.month, i.today),
          }
        : null,
    nextPlanned: planned
      ? {
          name: planned.name,
          cents: planned.amountCents,
          date: planned.nextDue,
        }
      : null,
    alerts: { count: i.alertCount },
  };
}
