import type { DateFormat } from "@/lib/dates";

export type SignConvention =
  | "outflow_negative"
  | "outflow_positive"
  | "debit_credit_cols";

export type BankProfile = {
  id?: number;
  name: string;
  headerSignature: string;
  dateCol: string;
  descCol: string;
  amountCol?: string | null;
  debitCol?: string | null;
  creditCol?: string | null;
  balanceCol?: string | null;
  dateFormat: DateFormat;
  signConvention: SignConvention;
  skipRows: number;
  builtin: boolean;
};

export type RawRow = Record<string, string>;

export type ParsedRow = {
  date: string;
  amountCents: number;
  rawDescription: string;
  merchant: string;
  balanceCents?: number | null;
};

export type RowError = { rowIndex: number; reason: string };
