export type Strategy = "avalanche" | "snowball";
export type DebtInput = {
  id: number;
  name: string;
  balanceCents: number;
  aprBps: number;
  minPaymentCents: number;
};
export type DebtResult = {
  id: number;
  payoffMonth: string | null;
  interestCents: number;
  paidCents: number;
  stalled: boolean;
};
export type PlanTotals = {
  months: number;
  interestCents: number;
  paidCents: number;
  finished: boolean;
  payoffMonth: string | null;
};
export type Plan = {
  strategy: Strategy;
  debts: DebtResult[];
  totals: PlanTotals;
  series: { month: string; remainingCents: number }[];
  order: number[];
};
export type DebtRow = {
  id: number;
  name: string;
  color: string;
  type: string;
  balanceCents: number | null;
  asOf: string | null;
  aprBps: number | null;
  minPaymentCents: number | null;
  ready: boolean; // ready = balance > 0 and both terms set
  missing: "terms" | "balance" | null; // what's blocking readiness, if anything
};
export type DebtPage = {
  today: string;
  strategy: Strategy;
  extraCents: number;
  debts: DebtRow[];
  plan: Plan | null;
  comparison: { avalanche: PlanTotals; snowball: PlanTotals } | null;
};
