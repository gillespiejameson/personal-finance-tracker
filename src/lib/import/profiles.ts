import type { BankProfile } from "./types";

export function headerSignature(headers: string[]): string {
  return headers
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

const P = (
  name: string,
  headers: string[],
  cols: Partial<BankProfile> &
    Pick<BankProfile, "dateCol" | "descCol" | "signConvention">,
): BankProfile => ({
  name,
  headerSignature: headerSignature(headers),
  dateFormat: "MDY",
  skipRows: 0,
  builtin: true,
  amountCol: null,
  debitCol: null,
  creditCol: null,
  balanceCol: null,
  ...cols,
});

export const BUILTIN_PROFILES: BankProfile[] = [
  P(
    "Chase (card)",
    [
      "Transaction Date",
      "Post Date",
      "Description",
      "Category",
      "Type",
      "Amount",
      "Memo",
    ],
    {
      dateCol: "Transaction Date",
      descCol: "Description",
      amountCol: "Amount",
      signConvention: "outflow_negative",
    },
  ),
  P(
    "Chase (checking)",
    [
      "Details",
      "Posting Date",
      "Description",
      "Amount",
      "Type",
      "Balance",
      "Check or Slip #",
    ],
    {
      dateCol: "Posting Date",
      descCol: "Description",
      amountCol: "Amount",
      balanceCol: "Balance",
      signConvention: "outflow_negative",
    },
  ),
  P("Bank of America", ["Date", "Description", "Amount", "Running Bal."], {
    dateCol: "Date",
    descCol: "Description",
    amountCol: "Amount",
    balanceCol: "Running Bal.",
    signConvention: "outflow_negative",
  }),
  P(
    "Capital One",
    [
      "Transaction Date",
      "Posted Date",
      "Card No.",
      "Description",
      "Category",
      "Debit",
      "Credit",
    ],
    {
      dateCol: "Transaction Date",
      descCol: "Description",
      debitCol: "Debit",
      creditCol: "Credit",
      signConvention: "debit_credit_cols",
      dateFormat: "YMD",
    },
  ),
  P("American Express", ["Date", "Description", "Amount"], {
    dateCol: "Date",
    descCol: "Description",
    amountCol: "Amount",
    signConvention: "outflow_positive",
  }),
  P(
    "Discover",
    ["Trans. Date", "Post Date", "Description", "Amount", "Category"],
    {
      dateCol: "Trans. Date",
      descCol: "Description",
      amountCol: "Amount",
      signConvention: "outflow_positive",
    },
  ),
  P(
    "Citi",
    ["Status", "Date", "Description", "Debit", "Credit", "Member Name"],
    {
      dateCol: "Date",
      descCol: "Description",
      debitCol: "Debit",
      creditCol: "Credit",
      signConvention: "debit_credit_cols",
    },
  ),
  P("Wells Fargo (headerless)", ["col1", "col2", "col3", "col4", "col5"], {
    dateCol: "col1",
    descCol: "col5",
    amountCol: "col2",
    signConvention: "outflow_negative",
  }),
];
