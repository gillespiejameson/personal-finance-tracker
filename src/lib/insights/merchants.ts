import { formatCents } from "@/lib/money";
import { bucketOf } from "./aggregate";
import type { Line } from "./lines";

export type MerchantStat = {
  merchant: string;
  totalCents: number;
  count: number;
  phrase: string;
};

export function merchantPhrase(
  totalCents: number,
  merchant: string,
  count: number,
): string {
  return `${formatCents(totalCents, { sign: "never" })} at ${merchant} across ${count} ${count === 1 ? "purchase" : "purchases"}`;
}

export function topMerchants(
  lines: Line[],
  month: string,
  by: "dollars" | "count",
  limit = 10,
): MerchantStat[] {
  const acc = new Map<string, { totalCents: number; txnIds: Set<number> }>();
  for (const l of lines) {
    if (l.month !== month || bucketOf(l) === "income") continue;
    const a = acc.get(l.merchant) ?? {
      totalCents: 0,
      txnIds: new Set<number>(),
    };
    a.totalCents += -l.amountCents;
    a.txnIds.add(l.txnId);
    acc.set(l.merchant, a);
  }
  return [...acc.entries()]
    .map(([merchant, a]) => ({
      merchant,
      totalCents: a.totalCents,
      count: a.txnIds.size,
      phrase: merchantPhrase(a.totalCents, merchant, a.txnIds.size),
    }))
    .filter((m) => m.totalCents > 0)
    .sort(
      (x, y) =>
        (by === "dollars" ? y.totalCents - x.totalCents : y.count - x.count) ||
        x.merchant.localeCompare(y.merchant),
    )
    .slice(0, limit);
}
