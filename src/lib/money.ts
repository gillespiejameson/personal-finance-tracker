const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function parseAmountToCents(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s$,]/g, "").replace(/−/g, "-");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d*(\.\d+)?$/.test(s) || s === "" || s === ".") return null;
  const cents = Math.round(Number(`${s}e2`)); // string exponent avoids 7.005*100 = 700.49999
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function formatCents(
  cents: number,
  opts: { sign?: "auto" | "always" | "never" } = {},
): string {
  const sign = opts.sign ?? "auto";
  const abs = fmt.format(Math.abs(cents) / 100);
  if (sign === "never") return abs;
  if (cents < 0) return `−${abs}`;
  if (cents > 0 && sign === "always") return `+${abs}`;
  return abs;
}

export function sumCents(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
