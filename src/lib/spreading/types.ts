export type Every = "year" | "quarter" | "once";
export type PlannedExpense = {
  id: number;
  name: string;
  amountCents: number;
  dueDate: string;
  every: Every;
  categoryId: number | null;
  createdAt: string;
  archived: boolean;
};
export type IrregularItem = {
  key: string; // "bill:<id>" | "planned:<id>"
  source: "bill" | "planned";
  id: number;
  name: string;
  amountCents: number;
  every: Every | "quarter" | "year";
  nextDue: string | null;
  periodMonths: number;
  monthlyCents: number;
  accruedCents: number;
  categoryId: number | null;
  categoryName: string | null;
  color: string | null;
  planned?: PlannedExpense; // editable fields when source = "planned"
};
export type SpreadByLeaf = Map<number, { cents: number; names: string[] }>;
