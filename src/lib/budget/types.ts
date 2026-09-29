import type { IrregularItem } from "@/lib/spreading/types";

export type PaydayConfig =
  | { schedule: "weekly" | "biweekly"; anchor: string }
  | { schedule: "semimonthly"; days: [number, number] }
  | { schedule: "monthly"; day: number };
export type ResolvedPayday = {
  config: PaydayConfig;
  inferred: boolean;
  next: string; // first schedule date strictly after today
  daysUntil: number; // daysBetween(today, next) ≥ 1
} | null;
export type Gate = { open: boolean; completeMonths: number; needed: number };
export type LeafMeta = {
  id: number;
  name: string;
  parentId: number;
  parentName: string;
  parentSeedKey: string | null;
  color: string;
  isFixed: boolean;
  isSavings: boolean; // parentSeedKey === "savings"
  rollover: boolean;
  sort: number;
  parentSort: number;
  goalId: number | null;
};
export type BudgetRow = {
  month: string;
  categoryId: number;
  amountCents: number;
};
export type Status = "ok" | "warn" | "over";
export type BudgetLeaf = {
  id: number;
  name: string;
  color: string;
  parentId: number;
  parentName: string;
  isFixed: boolean;
  isSavings: boolean;
  rollover: boolean;
  goalId: number | null;
  budgeted: number;
  carry: number;
  available: number;
  spent: number;
  remaining: number;
  status: Status;
  fill: number; // 0..1 of available consumed, 1 when over
  hasRow: boolean;
  setAside: { cents: number; names: string[] } | null;
};
export type BudgetGroup = {
  parentId: number;
  parentName: string;
  color: string;
  leaves: BudgetLeaf[];
  budgeted: number;
  spent: number;
  remaining: number;
};
export type Strip = {
  needs: number;
  wants: number;
  save: number;
  needsPct: number;
  wantsPct: number;
  savePct: number;
};
export type RestOfMonth = {
  totalCents: number;
  perDayCents: number;
  unpostedBillsCents: number;
  horizon: string; // last day of the month
  daysUntil: number; // days left including today
};
export type SafeToSpend = {
  totalCents: number;
  perDayCents: number;
  variableRemainingCents: number;
  unpostedBillsCents: number;
  horizon: string;
  daysUntil: number;
  horizonKind: "payday" | "monthEnd";
  /** The same math through month end, shown beside a payday figure; null on the month-end horizon. */
  restOfMonth: RestOfMonth | null;
};
export type BudgetPage = {
  month: string;
  months: string[];
  today: string;
  isCurrent: boolean;
  gate: Gate;
  hasBudget: boolean;
  prevHasBudget: boolean;
  nextHasBudget: boolean;
  incomeCents: number;
  assignedCents: number;
  leftToAssignCents: number;
  budgetedCents: number;
  spentCents: number;
  strip: Strip;
  groups: BudgetGroup[];
  overspent: BudgetLeaf[];
  unbudgeted: BudgetLeaf[];
  uncategorizedCents: number;
  safeToSpend: SafeToSpend | null;
  payday: ResolvedPayday;
  setAside: IrregularItem[];
};
export type SetupRow = {
  categoryId: number;
  name: string;
  parentId: number;
  parentName: string;
  color: string;
  isFixed: boolean;
  isSavings: boolean;
  goalId: number | null;
  avgCents: number;
  lastMonthCents: number;
  billsCents: number;
  plannedCents: number;
  plannedNames: string[];
  suggestedCents: number;
  hasHistory: boolean;
};
export type SetupPage = {
  month: string;
  incomeCents: number;
  uncategorizedIncomeCents: number;
  uncategorizedSpendCents: number;
  avgMonths: number;
  rows: SetupRow[];
};
