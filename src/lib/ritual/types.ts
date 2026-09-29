export type ReviewStatus = {
  doneThisWeek: boolean;
  lastCompleted: string | null; // completedAt date (YYYY-MM-DD) of the latest review
  daysSince: number | null;
  due: boolean;
  streak: number;
  currentWeekStart: string;
};
export type Staleness = "fresh" | "aging" | "stale" | "never";
export type AccountImportRow = {
  id: number;
  name: string;
  color: string;
  lastImport: string | null;
  /** Newest SimpleFIN sync for this account; null when it is not linked. */
  syncedAt: string | null;
  daysSince: number | null;
  staleness: Staleness;
};
export type PaceStatus = "ahead" | "on" | "behind";
export type Pace = {
  elapsed: number;
  used: number;
  status: PaceStatus;
  spentCents: number;
  referenceCents: number;
  reference: "budget" | "average" | "none";
};
export type PaceLeaf = {
  id: number;
  name: string;
  parentName: string;
  color: string;
  remaining: number;
  status: "over" | "warn";
};
export type BillRow = {
  id: number;
  merchant: string;
  dueInDays: number;
  amountCents: number;
  nextExpected: string;
  overdue: boolean;
};
export type WeeklyPage = {
  today: string;
  month: string;
  status: ReviewStatus;
  accounts: AccountImportRow[];
  queueCount: number;
  pace: Pace;
  overspent: PaceLeaf[];
  warn: PaceLeaf[];
  gateOpen: boolean;
  hasBudget: boolean;
  bills: BillRow[]; // overdue first, then due within 7 days, sorted by nextExpected
  budgetLeftToAssign: number | null;
  alertCount: number; // current, non-dismissed anomalies
  goals: {
    count: number;
    nearest: { name: string; targetDate: string; pct: number } | null;
  };
};
