import { parseDateWithFormat } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";
import { cleanMerchant } from "@/lib/normalize/merchant";
import type { BankProfile, ParsedRow, RawRow, RowError } from "./types";

type Result = { ok: true; row: ParsedRow } | { ok: false; error: RowError };

export function normalizeRow(
  row: RawRow,
  profile: BankProfile,
  rowIndex: number,
): Result {
  const fail = (reason: string): Result => ({
    ok: false,
    error: { rowIndex, reason },
  });
  const date = parseDateWithFormat(
    row[profile.dateCol] ?? "",
    profile.dateFormat,
  );
  if (!date) return fail(`Bad date "${row[profile.dateCol] ?? ""}"`);

  let amountCents: number | null = null;
  if (profile.signConvention === "debit_credit_cols") {
    const debit = parseAmountToCents(row[profile.debitCol ?? ""] ?? "");
    const credit = parseAmountToCents(row[profile.creditCol ?? ""] ?? "");
    if (debit !== null && debit !== 0) amountCents = -Math.abs(debit);
    else if (credit !== null && credit !== 0) amountCents = Math.abs(credit);
    else if (debit !== null || credit !== null) amountCents = 0;
  } else {
    const a = parseAmountToCents(row[profile.amountCol ?? ""] ?? "");
    if (a !== null)
      amountCents = profile.signConvention === "outflow_positive" ? -a : a;
  }
  if (amountCents === null) return fail("Missing amount");

  const rawDescription = (row[profile.descCol] ?? "").trim();
  if (!rawDescription) return fail("Missing description");
  const balanceRaw = profile.balanceCol ? row[profile.balanceCol] : undefined;
  const balanceCents = balanceRaw ? parseAmountToCents(balanceRaw) : null;
  return {
    ok: true,
    row: {
      date,
      amountCents,
      rawDescription,
      merchant: cleanMerchant(rawDescription),
      balanceCents,
    },
  };
}
