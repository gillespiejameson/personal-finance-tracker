import { daysBetween, localDay } from "@/lib/dates";
import { relativeSince } from "./relative";
import type { Connection, LinkedAccount, StaleBank } from "./types";

/**
 * How far an account's balance date may trail the last sync before the bank
 * counts as stale. SimpleFIN stamps each balance with when it last reached the
 * bank, so a date that stops moving while syncs keep succeeding means the
 * bridge has lost that bank (usually a login it needs renewed). A few days
 * cover weekends and slow cut-offs.
 */
export const STALE_BALANCE_DAYS = 3;

/**
 * Banks whose mapped, enabled accounts all report balance dates more than
 * `STALE_BALANCE_DAYS` before the last sync's local day, sorted by name. A
 * bank with any fresh account still reaches SimpleFIN, so one dormant
 * account there does not flag it.
 */
export function staleBanks(
  accounts: LinkedAccount[],
  lastSyncAt: string | null,
): StaleBank[] {
  if (!lastSyncAt) return [];
  const syncDay = localDay(new Date(lastSyncAt));
  const byOrg = new Map<string, StaleBank>();
  const fresh = new Set<string>();
  for (const a of accounts) {
    if (!a.enabled || a.accountId === null || !a.balanceDate) continue;
    const orgName = a.orgName ?? "SimpleFIN";
    if (daysBetween(a.balanceDate, syncDay) <= STALE_BALANCE_DAYS) {
      fresh.add(orgName);
      continue;
    }
    const bank = byOrg.get(orgName);
    if (!bank)
      byOrg.set(orgName, {
        orgName,
        lastUpdated: a.balanceDate,
        accounts: [a.name],
      });
    else {
      bank.accounts.push(a.name);
      if (a.balanceDate > bank.lastUpdated) bank.lastUpdated = a.balanceDate;
    }
  }
  return [...byOrg.values()]
    .filter((b) => !fresh.has(b.orgName))
    .sort((x, y) => x.orgName.localeCompare(y.orgName));
}

/** "Sep 16" for a `YYYY-MM-DD` day. */
export function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * The one-line sync status Home shows beside Sync now. Anything the user
 * should act on is `attention` and points at Settings, most serious first:
 * a failed sync, then banks that stopped sending data, then warnings.
 */
export function syncCaption(
  c: Pick<Connection, "lastError" | "lastSyncAt" | "staleBanks" | "warnings">,
  now: Date,
): { text: string; attention: boolean } {
  if (c.lastError)
    return { text: "Sync needs attention — open Settings", attention: true };
  if (c.staleBanks.length === 1) {
    const [bank] = c.staleBanks;
    return {
      text: `${bank.orgName} hasn't sent new data since ${shortDay(bank.lastUpdated)} — open Settings`,
      attention: true,
    };
  }
  if (c.staleBanks.length > 1)
    return {
      text: `${c.staleBanks.length} banks haven't sent new data — open Settings`,
      attention: true,
    };
  if (c.warnings.length > 0)
    return { text: "Last sync had warnings — open Settings", attention: true };
  if (c.lastSyncAt)
    return {
      text: `Synced ${relativeSince(c.lastSyncAt, now)}`,
      attention: false,
    };
  return { text: "Not synced yet", attention: false };
}
