import type { BudgetLeaf, BudgetPage } from "@/lib/budget/types";
import type { Goal } from "@/lib/goals/types";
import type { Bill } from "@/lib/recurring/refresh";
import { pace } from "./pace";
import type {
  AccountImportRow,
  BillRow,
  PaceLeaf,
  ReviewStatus,
  WeeklyPage,
} from "./types";

function toPaceLeaf(l: BudgetLeaf): PaceLeaf {
  return {
    id: l.id,
    name: l.name,
    parentName: l.parentName,
    color: l.color,
    remaining: l.remaining,
    status: l.status as "over" | "warn",
  };
}

function buildBills(bills: Bill[], today: string): BillRow[] {
  return bills
    .filter((b) => b.active && !b.dismissed && !b.isIncome)
    .map((b) => ({
      id: b.id,
      merchant: b.merchant,
      dueInDays: b.dueInDays,
      amountCents: b.avgCents,
      nextExpected: b.nextExpected,
      overdue: b.nextExpected < today,
    }))
    .filter((b) => b.overdue || (b.dueInDays >= 0 && b.dueInDays <= 7))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return a.nextExpected.localeCompare(b.nextExpected);
    });
}

function buildGoals(goals: Goal[]): WeeklyPage["goals"] {
  const active = goals.filter((g) => !g.archived);
  const dated = active
    .filter((g): g is Goal & { targetDate: string } => g.targetDate !== null)
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const nearest = dated[0]
    ? {
        name: dated[0].name,
        targetDate: dated[0].targetDate,
        pct: dated[0].pct,
      }
    : null;
  return { count: active.length, nearest };
}

export function buildWeeklyPage(i: {
  today: string;
  status: ReviewStatus;
  accounts: AccountImportRow[];
  queueCount: number;
  budget: BudgetPage;
  insightsSpent: number;
  avgSpend: number | null;
  bills: Bill[];
  goals: Goal[];
  alertCount: number;
}): WeeklyPage {
  const month = i.today.slice(0, 7);
  const p =
    i.budget.gate.open && i.budget.hasBudget
      ? pace({
          spentCents: i.budget.spentCents,
          referenceCents: i.budget.budgetedCents,
          today: i.today,
          reference: "budget",
        })
      : i.avgSpend !== null && i.avgSpend > 0
        ? pace({
            spentCents: i.insightsSpent,
            referenceCents: i.avgSpend,
            today: i.today,
            reference: "average",
          })
        : pace({
            spentCents: 0,
            referenceCents: 0,
            today: i.today,
            reference: "none",
          });

  const leaves = i.budget.groups.flatMap((g) => g.leaves);
  const overspent = leaves
    .filter((l) => l.status === "over")
    .map(toPaceLeaf)
    .sort((a, b) => a.remaining - b.remaining);
  const warn = leaves
    .filter((l) => l.status === "warn")
    .map(toPaceLeaf)
    .sort((a, b) => a.remaining - b.remaining);

  return {
    today: i.today,
    month,
    status: i.status,
    accounts: i.accounts,
    queueCount: i.queueCount,
    pace: p,
    overspent,
    warn,
    gateOpen: i.budget.gate.open,
    hasBudget: i.budget.hasBudget,
    bills: buildBills(i.bills, i.today),
    budgetLeftToAssign: i.budget.hasBudget ? i.budget.leftToAssignCents : null,
    goals: buildGoals(i.goals),
    alertCount: i.alertCount,
  };
}
