import type { ParsedRow } from "@/lib/import/types";
import { cleanMerchant } from "@/lib/normalize/merchant";
import type { SfinTransaction } from "./types";

/**
 * Numeric string → integer cents. SimpleFIN sends plain decimals ("-12.34",
 * "1234.5"); anything else (commas, blanks, exponents) is rejected.
 */
export function amountToCents(s: string): number | null {
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const whole = Number(m[2]);
  const frac = m[3] ?? "";
  let cents: number;
  if (frac.length <= 2) cents = Number(frac.padEnd(2, "0") || "0");
  else cents = Math.round(Number(`${frac.slice(0, 2)}.${frac.slice(2)}`));
  const total = whole * 100 + cents;
  if (!Number.isSafeInteger(total)) return null;
  return sign * total;
}

/** UTC calendar date of a unix-seconds timestamp. */
export function utcDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * The date a transaction belongs to: `posted`, or `transacted_at` while
 * pending. A null timestamp reads exactly like a missing one.
 */
export function sfinDate(t: SfinTransaction): string {
  if (t.posted > 0) return utcDate(t.posted);
  if (t.transacted_at != null && t.transacted_at > 0)
    return utcDate(t.transacted_at);
  throw new Error(`transaction ${t.id} has no posted or transacted_at time`);
}

export function isPending(t: SfinTransaction): boolean {
  return t.pending === true || !(t.posted > 0);
}

/** `description` (or `payee`), with the memo appended when it adds information. */
export function descriptionOf(t: SfinTransaction): string {
  const base = (t.description ?? "").trim() || (t.payee ?? "").trim();
  const memo = (t.memo ?? "").trim();
  if (!memo) return base;
  if (!base) return memo;
  if (base.toLowerCase().includes(memo.toLowerCase())) return base;
  return `${base} · ${memo}`;
}

export type MappedRow = {
  row: ParsedRow;
  externalId: string;
  pending: boolean;
};

/**
 * Map protocol transactions to import rows. A transaction that cannot be
 * parsed (bad amount, no timestamp) is skipped and reported, never inserted.
 */
export function toParsedRows(txns: SfinTransaction[]): {
  rows: MappedRow[];
  skipped: string[];
} {
  const rows: MappedRow[] = [];
  const skipped: string[] = [];
  for (const t of txns) {
    const amountCents = amountToCents(t.amount);
    if (amountCents === null) {
      skipped.push(
        `Skipped transaction ${t.id}: unreadable amount "${t.amount}".`,
      );
      continue;
    }
    let date: string;
    try {
      date = sfinDate(t);
    } catch {
      skipped.push(`Skipped transaction ${t.id}: no date.`);
      continue;
    }
    const rawDescription = descriptionOf(t) || "(no description)";
    rows.push({
      row: {
        date,
        amountCents,
        rawDescription,
        merchant: cleanMerchant(rawDescription),
      },
      externalId: t.id,
      pending: isPending(t),
    });
  }
  return { rows, skipped };
}
