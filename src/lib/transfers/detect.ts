import { daysBetween } from "@/lib/dates";

export type TxnLite = {
  id: number;
  accountId: number;
  date: string;
  amountCents: number;
  rawDescription: string;
  isTransfer: boolean;
};
export type Pair = { fromId: number; toId: number; confidence: number };

/**
 * Minimum-cost maximum-cardinality assignment via the Hungarian algorithm
 * (Kuhn-Munkres, O(m^3), potentials-based implementation).
 *
 * `cost` is an m x m matrix (1-indexed internally). Returns, for each row
 * index (0-indexed), the assigned column index (0-indexed).
 */
function hungarian(cost: number[][]): number[] {
  const m = cost.length;
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array(m + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0); // p[j] = row assigned to column j
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = -1;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const rowToCol = new Array(m).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] !== 0) rowToCol[p[j] - 1] = j - 1;
  }
  return rowToCol;
}

/**
 * Exact minimum-cost maximum-cardinality pairing between outflows and
 * inflows within each equal-absolute-amount bucket.
 *
 * A naive greedy or augmenting-path matching maximizes the NUMBER of pairs
 * but is indifferent among maximum matchings, so it can pick an assignment
 * with unnecessarily large date gaps when a same-count, smaller-total-gap
 * assignment exists (e.g. it might pick two 1-and-3-day pairs when two
 * 0-and-2-day pairs would also fully match everyone). To get both the
 * maximum count AND, among maximum matchings, the smallest total date
 * distance, each bucket is solved as a minimum-cost assignment problem:
 * pad the (possibly non-square) outs x ins matrix to square with a
 * penalty cost larger than any possible sum of real edge costs, so the
 * Hungarian algorithm first maximizes real (in-window, cross-account)
 * edges used, then minimizes their total distance.
 */
export function pairTransfers(
  txns: TxnLite[],
  opts: { days?: number } = {},
): Pair[] {
  const days = opts.days ?? 3;
  const outs = txns
    .filter((t) => !t.isTransfer && t.amountCents < 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const ins = txns
    .filter((t) => !t.isTransfer && t.amountCents > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const outsByAmt = new Map<number, TxnLite[]>();
  for (const o of outs) {
    const l = outsByAmt.get(o.amountCents) ?? [];
    l.push(o);
    outsByAmt.set(o.amountCents, l);
  }
  const insByAmt = new Map<number, TxnLite[]>();
  for (const i of ins) {
    const l = insByAmt.get(i.amountCents) ?? [];
    l.push(i);
    insByAmt.set(i.amountCents, l);
  }

  const pairs: Pair[] = [];

  for (const [amt, bucketOuts] of outsByAmt) {
    const bucketIns = insByAmt.get(-amt) ?? [];
    if (bucketIns.length === 0) continue;

    const m = Math.max(bucketOuts.length, bucketIns.length);
    const BIG = m * (days + 1) + 1;
    const cost: number[][] = [];
    for (let i = 0; i < m; i++) {
      const row: number[] = [];
      for (let j = 0; j < m; j++) {
        const o = bucketOuts[i];
        const inn = bucketIns[j];
        if (!o || !inn || o.accountId === inn.accountId) {
          row.push(BIG);
          continue;
        }
        const distance = Math.abs(daysBetween(o.date, inn.date));
        row.push(distance <= days ? distance : BIG);
      }
      cost.push(row);
    }

    const rowToCol = hungarian(cost);
    for (let i = 0; i < bucketOuts.length; i++) {
      const j = rowToCol[i];
      if (j < 0 || j >= bucketIns.length) continue;
      if (cost[i][j] >= BIG) continue;
      const o = bucketOuts[i];
      const inn = bucketIns[j];
      pairs.push({
        fromId: o.id,
        toId: inn.id,
        confidence: o.date === inn.date ? 100 : 90,
      });
    }
  }

  return pairs;
}

/** Bank wording for money moved between the user's own accounts (either side). */
export const OWN_TRANSFER_PATTERNS: RegExp[] = [
  /\bonline\s+(?:banking\s+)?transfer\b/i,
  /\btransfer\s+(?:to|from)\s+(?:chk|sav|checking|savings|mma|money\s+market)\b/i,
  /\bach\s+xfer\b/i,
  /\bxfer\s+(?:to|from)\s+(?:chk|sav|checking|savings)\b/i,
];

/** The credit-card statement's side of a card payment. Only meaningful on a credit account. */
export const CARD_SIDE_PATTERNS: RegExp[] = [
  /payment\s*[-–]?\s*thank\s*you/i,
  /\bautomatic\s+payment\b/i,
  /\bautopay\s+payment\b/i,
  /\bmobile\s+payment\b/i,
  /\bonline\s+payment\b/i,
];

export function isOwnTransfer(desc: string, accountType: string): boolean {
  if (OWN_TRANSFER_PATTERNS.some((re) => re.test(desc))) return true;
  return (
    accountType === "credit" && CARD_SIDE_PATTERNS.some((re) => re.test(desc))
  );
}
