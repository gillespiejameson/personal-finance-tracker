/**
 * RFC 4180 CSV: quote a field only when it contains a comma, quote, or line
 * break, doubling any quotes inside. Plain fields (including ones with
 * leading/trailing spaces) pass through unchanged.
 */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Formula-injection guard for user-controlled text columns (account,
 * merchant, description, category_group, category, splits): a leading `=`,
 * `+`, `-`, `@`, tab, or CR is how a spreadsheet decides to treat a cell as a
 * formula, so prefix a single quote to force it back to plain text. Never
 * apply this to numeric columns (amount) — a negative amount must round-trip
 * unchanged. `csvField`'s own RFC 4180 quoting still runs afterward in
 * `toCsv`.
 */
export function csvText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Header first, then rows, each field quoted per `csvField` and every line
 * (including the last) ending in `\r\n`.
 */
export function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows]
    .map((row) => `${row.map(csvField).join(",")}\r\n`)
    .join("");
}

/** Integer cents to a signed decimal string with exactly two places. */
export function centsToDecimal(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new TypeError("cents must be an integer");
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}
