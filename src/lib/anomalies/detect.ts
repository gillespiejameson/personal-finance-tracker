import { addDays, daysBetween } from "@/lib/dates";
import type { Line } from "@/lib/insights/lines";
import { formatCents } from "@/lib/money";
import type { Bill } from "@/lib/recurring/refresh";
import type { Anomaly } from "./types";

export const RECENT_DAYS = 30;
export const CATEGORY_WINDOW_DAYS = 90;
export const MERCHANT_RATIO = 3;
export const MERCHANT_MIN_CENTS = 2500;
export const CATEGORY_MIN_ROWS = 10;
export const CATEGORY_MIN_CENTS = 5000;
export const NEW_MERCHANT_MIN_CENTS = 20000;
export const BILL_JUMP_FRACTION = 0.15;
export const BILL_JUMP_MIN_CENTS = 500;
export const DOUBLE_CHARGE_DAYS = 2;
export const DOUBLE_CHARGE_MIN_CENTS = 2000;

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function meanStd(xs: number[]): { mean: number; std: number } {
  if (xs.length === 0) return { mean: 0, std: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean, std: Math.sqrt(variance) };
}

function catName(l: Line): string | null {
  return l.categoryId === null ? null : l.leafName;
}

function sameMerchant(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function merchantSpikes(recent: Line[], outflows: Line[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const t of recent) {
    const earlier = outflows.filter(
      (l) => l.date < t.date && sameMerchant(l.merchant, t.merchant),
    );
    if (earlier.length < 3) continue;
    const med = median(earlier.map((l) => Math.abs(l.amountCents)));
    if (med <= 0) continue;
    const amt = Math.abs(t.amountCents);
    const ratio = amt / med;
    if (ratio < MERCHANT_RATIO || amt < MERCHANT_MIN_CENTS) continue;
    out.push({
      key: `merchant-spike:${t.txnId}`,
      kind: "merchant-spike",
      txnId: t.txnId,
      date: t.date,
      merchant: t.merchant,
      amountCents: t.amountCents,
      categoryName: catName(t),
      reason: `${ratio.toFixed(1)}× this merchant's usual ${formatCents(Math.round(med), { sign: "never" })}`,
      score: ratio,
    });
  }
  return out;
}

function categorySpikes(
  recent: Line[],
  outflows: Line[],
  suppressed: Set<number>,
): Anomaly[] {
  const out: Anomaly[] = [];
  for (const t of recent) {
    if (t.categoryId === null || suppressed.has(t.txnId)) continue;
    const windowStart = addDays(t.date, -CATEGORY_WINDOW_DAYS);
    const baseline = outflows.filter(
      (l) =>
        l.categoryId === t.categoryId &&
        l.date >= windowStart &&
        l.date < t.date,
    );
    if (baseline.length < CATEGORY_MIN_ROWS) continue;
    const { mean, std } = meanStd(baseline.map((l) => Math.abs(l.amountCents)));
    if (std <= 0) continue;
    const amt = Math.abs(t.amountCents);
    if (amt <= mean + 2 * std || amt < CATEGORY_MIN_CENTS) continue;
    out.push({
      key: `category-spike:${t.txnId}`,
      kind: "category-spike",
      txnId: t.txnId,
      date: t.date,
      merchant: t.merchant,
      amountCents: t.amountCents,
      categoryName: catName(t),
      reason: `Well above the usual ${t.leafName} purchase (avg ${formatCents(Math.round(mean), { sign: "never" })})`,
      score: (amt - mean) / std,
    });
  }
  return out;
}

function newMerchants(recent: Line[], allLines: Line[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const t of recent) {
    const amt = Math.abs(t.amountCents);
    if (amt < NEW_MERCHANT_MIN_CENTS) continue;
    const seenBefore = allLines.some(
      (l) => l.date < t.date && sameMerchant(l.merchant, t.merchant),
    );
    if (seenBefore) continue;
    out.push({
      key: `new-merchant:${t.txnId}`,
      kind: "new-merchant",
      txnId: t.txnId,
      date: t.date,
      merchant: t.merchant,
      amountCents: t.amountCents,
      categoryName: catName(t),
      reason: "First time at this merchant",
      score: amt / NEW_MERCHANT_MIN_CENTS,
    });
  }
  return out;
}

function billJumps(bills: Bill[], recent: Line[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const b of bills) {
    if (!b.active || b.dismissed || b.isIncome) continue;
    const avg = Math.abs(b.avgCents);
    if (avg <= 0) continue;
    const match = recent.find(
      (l) => l.date === b.lastSeen && sameMerchant(l.merchant, b.merchant),
    );
    if (!match) continue;
    const amt = Math.abs(match.amountCents);
    const diff = amt - avg;
    if (amt <= avg * (1 + BILL_JUMP_FRACTION) || diff < BILL_JUMP_MIN_CENTS)
      continue;
    out.push({
      key: `bill-jump:${match.txnId}`,
      kind: "bill-jump",
      txnId: match.txnId,
      date: match.date,
      merchant: match.merchant,
      amountCents: match.amountCents,
      categoryName: catName(match),
      reason: `${formatCents(amt, { sign: "never" })} vs the usual ${formatCents(avg, { sign: "never" })}`,
      score: amt / avg,
    });
  }
  return out;
}

function doubleCharges(
  recent: Line[],
  possibleDuplicateIds: Set<number>,
): Anomaly[] {
  const groups = new Map<string, Line[]>();
  for (const l of recent) {
    const k = `${l.merchant.toLowerCase()}|${l.amountCents}`;
    const g = groups.get(k);
    if (g) g.push(l);
    else groups.set(k, [l]);
  }
  const out: Anomaly[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) => a.date.localeCompare(b.date) || a.txnId - b.txnId,
    );
    // Pairing is adjacent-only: three same-amount charges in quick
    // succession (e.g. days 0, 1, 2) produce two anomalies, one per
    // adjacent pair (0-1 and 1-2), not one for every combination.
    for (let i = 0; i < sorted.length - 1; i++) {
      const earlier = sorted[i];
      const later = sorted[i + 1];
      if (earlier.txnId === later.txnId) continue;
      if (Math.abs(later.amountCents) < DOUBLE_CHARGE_MIN_CENTS) continue;
      if (
        possibleDuplicateIds.has(earlier.txnId) ||
        possibleDuplicateIds.has(later.txnId)
      )
        continue;
      const days = daysBetween(earlier.date, later.date);
      if (days < 0 || days > DOUBLE_CHARGE_DAYS) continue;
      const apart =
        days === 0
          ? "on the same day"
          : `${days} day${days === 1 ? "" : "s"} apart`;
      out.push({
        key: `double-charge:${later.txnId}`,
        kind: "double-charge",
        txnId: later.txnId,
        date: later.date,
        merchant: later.merchant,
        amountCents: later.amountCents,
        categoryName: catName(later),
        reason: `Same amount at the same merchant ${apart}`,
        score: 2,
      });
    }
  }
  return out;
}

export function detectAnomalies(i: {
  lines: Line[];
  bills: Bill[];
  today: string;
  possibleDuplicateIds: Set<number>;
}): Anomaly[] {
  const outflows = i.lines.filter((l) => l.amountCents < 0);
  const cutoff = addDays(i.today, -RECENT_DAYS);
  const recent = outflows.filter((l) => l.date >= cutoff);

  const merchant = merchantSpikes(recent, outflows);
  const newMerchant = newMerchants(recent, i.lines);
  const suppressed = new Set([
    ...merchant.map((a) => a.txnId),
    ...newMerchant.map((a) => a.txnId),
  ]);
  const category = categorySpikes(recent, outflows, suppressed);
  const bill = billJumps(i.bills, recent);
  const doubleCharge = doubleCharges(recent, i.possibleDuplicateIds);

  const byKey = new Map<string, Anomaly>();
  for (const a of [
    ...merchant,
    ...category,
    ...newMerchant,
    ...bill,
    ...doubleCharge,
  ])
    if (!byKey.has(a.key)) byKey.set(a.key, a);

  return [...byKey.values()].sort(
    (a, b) => b.score - a.score || b.date.localeCompare(a.date),
  );
}
