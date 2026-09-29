import { monthEnd, monthOf } from "@/lib/dates";
import { shiftMonth } from "@/lib/insights/page";
import type { NetWorthPoint, Snapshot } from "./types";

export type AccountSnapshot = Snapshot & { accountId: number };
export type AccountInfo = { id: number; isLiability: boolean };
export type NetWorthTotals = {
  netWorthCents: number;
  assetsCents: number;
  liabilitiesCents: number;
};

/** The latest snapshot on or before `today` for each account (a future-dated snapshot is ignored). */
export function latestBalances(
  snapshots: AccountSnapshot[],
  today: string,
): Map<number, Snapshot> {
  const out = new Map<number, Snapshot>();
  for (const s of snapshots) {
    if (s.date > today) continue;
    const cur = out.get(s.accountId);
    if (!cur || s.date > cur.date)
      out.set(s.accountId, { date: s.date, balanceCents: s.balanceCents });
  }
  return out;
}

/** Net worth (assets minus liabilities) as of `date`, carrying each account's latest snapshot forward. */
export function netWorthAt(
  snapshots: AccountSnapshot[],
  accounts: AccountInfo[],
  date: string,
): NetWorthTotals {
  const balances = latestBalances(snapshots, date);
  let assetsCents = 0;
  let liabilitiesCents = 0;
  for (const a of accounts) {
    const bal = balances.get(a.id);
    if (!bal) continue;
    if (a.isLiability) liabilitiesCents += bal.balanceCents;
    else assetsCents += bal.balanceCents;
  }
  return {
    netWorthCents: assetsCents - liabilitiesCents,
    assetsCents,
    liabilitiesCents,
  };
}

/**
 * True when every account holding a balance as of `today` also held one as
 * of `cutoff` — i.e. the 30-day delta has a real starting point for each
 * account currently counted, not just some of them.
 */
export function deltaAvailable(
  snapshots: AccountSnapshot[],
  accounts: AccountInfo[],
  today: string,
  cutoff: string,
): boolean {
  const latestToday = latestBalances(snapshots, today);
  const latestCutoff = latestBalances(snapshots, cutoff);
  return accounts.every(
    (a) => !latestToday.has(a.id) || latestCutoff.has(a.id),
  );
}

/**
 * Month-end points from the first snapshot's month through the month before
 * the current one, plus `today`. Empty when there are no snapshots yet (or
 * none are dated on or before `today`).
 */
export function netWorthSeries(
  snapshots: AccountSnapshot[],
  accounts: AccountInfo[],
  today: string,
): NetWorthPoint[] {
  const past = snapshots.filter((s) => s.date <= today);
  if (past.length === 0) return [];
  const firstMonth = monthOf(
    past.map((s) => s.date).sort((a, b) => a.localeCompare(b))[0],
  );
  const currentMonth = monthOf(today);
  const points: NetWorthPoint[] = [];
  for (
    let month = firstMonth;
    month < currentMonth;
    month = shiftMonth(month, 1)
  ) {
    const date = monthEnd(month);
    points.push({ date, ...netWorthAt(snapshots, accounts, date) });
  }
  const last: NetWorthPoint = {
    date: today,
    ...netWorthAt(snapshots, accounts, today),
  };
  if (points.length === 0 || points[points.length - 1].date !== today)
    points.push(last);
  return points;
}
