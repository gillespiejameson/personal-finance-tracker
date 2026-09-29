import { createHash } from "node:crypto";
import { daysBetween } from "@/lib/dates";
import type { ParsedRow } from "./types";

export function normalizeForHash(desc: string): string {
  return desc.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

export function dedupeHash(
  accountId: number,
  row: Pick<ParsedRow, "date" | "amountCents" | "rawDescription">,
  occurrence = 0,
): string {
  const base = `${accountId}|${row.date}|${row.amountCents}|${normalizeForHash(row.rawDescription)}`;
  return createHash("sha256")
    .update(occurrence > 0 ? `${base}|${occurrence}` : base)
    .digest("hex");
}

export function fileHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array<boolean>(la).fill(false);
  const mb = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(lb - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = true;
      mb[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  return (matches / la + matches / lb + (matches - t) / matches) / 3;
}

export function similarity(a: string, b: string): number {
  const x = normalizeForHash(a);
  const y = normalizeForHash(b);
  const j = jaro(x, y);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, x.length, y.length) && x[i] === y[i]; i++)
    prefix++;
  return j + prefix * 0.1 * (1 - j);
}

type Existing = {
  id: number;
  date: string;
  amountCents: number;
  rawDescription: string;
};

export function findFuzzyDuplicates(
  incoming: ParsedRow[],
  existing: Existing[],
  opts: { days?: number; threshold?: number } = {},
): Map<number, number> {
  const days = opts.days ?? 3;
  const threshold = opts.threshold ?? 0.85;
  const byAmount = new Map<number, Existing[]>();
  for (const e of existing) {
    const list = byAmount.get(e.amountCents) ?? [];
    list.push(e);
    byAmount.set(e.amountCents, list);
  }
  const out = new Map<number, number>();
  incoming.forEach((row, i) => {
    for (const e of byAmount.get(row.amountCents) ?? []) {
      if (Math.abs(daysBetween(e.date, row.date)) > days) continue;
      if (similarity(e.rawDescription, row.rawDescription) >= threshold) {
        out.set(i, e.id);
        break;
      }
    }
  });
  return out;
}
