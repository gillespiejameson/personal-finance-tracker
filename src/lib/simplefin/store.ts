import { and, eq, isNotNull, min, ne } from "drizzle-orm";
import { localDay } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import {
  accounts,
  settings,
  simplefinAccounts,
  transactions,
} from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import {
  bump,
  countToday,
  DAILY_CAP,
  EMPTY_STATE,
  NUDGE_HOURS,
  type RequestState,
} from "./budget";
import { maskAccessUrl } from "./client";
import { amountToCents } from "./map";
import { hoursSince } from "./relative";
import { staleBanks } from "./stale";
import type { Connection, LinkedAccount, SfinAccount } from "./types";

export const KEYS = {
  /** The access URL with its credentials: a secret; never render or log it. */
  accessUrl: "simplefin_access_url",
  connectedAt: "simplefin_connected_at",
  lastSyncAt: "simplefin_last_sync_at",
  /** Every attempt that reached the gate, whatever it returned. */
  lastAttemptAt: "simplefin_last_attempt_at",
  /** Set when a sync fails, cleared when one succeeds. */
  lastError: "simplefin_last_error",
  /** Replaced by every regular sync, so an empty list means the last one was clean. */
  lastWarnings: "simplefin_last_warnings",
  /** The earliest date "Load older history" has already asked the bank for. */
  historyFloor: "simplefin_history_floor",
  auto: "simplefin_auto",
  requests: "simplefin_requests",
} as const;

/** Settings a fresh connection must not inherit from the previous one. */
const PER_CONNECTION_KEYS = [
  KEYS.lastSyncAt,
  KEYS.lastAttemptAt,
  KEYS.lastError,
  KEYS.lastWarnings,
  KEYS.historyFloor,
] as const;

function deleteSetting(db: Db, key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}

/** Only the sync engine should read this; actions never return it. */
export function getAccessUrl(db: Db): string | null {
  const v = getSetting<string | null>(db, KEYS.accessUrl, null);
  return typeof v === "string" && v ? v : null;
}

export function setAccessUrl(db: Db, url: string, now: Date): void {
  setSetting(db, KEYS.accessUrl, url);
  setSetting(db, KEYS.connectedAt, now.toISOString());
  for (const k of PER_CONNECTION_KEYS) deleteSetting(db, k);
}

/** Forget the access URL; linked accounts stay listed (disabled), transactions stay. */
export function clearConnection(db: Db): void {
  db.transaction((tx) => {
    deleteSetting(tx as Db, KEYS.accessUrl);
    deleteSetting(tx as Db, KEYS.connectedAt);
    for (const k of PER_CONNECTION_KEYS) deleteSetting(tx as Db, k);
    tx.update(simplefinAccounts).set({ enabled: false }).run();
  });
}

export function getLastSyncAt(db: Db): string | null {
  return getSetting<string | null>(db, KEYS.lastSyncAt, null);
}

export function setLastSyncAt(db: Db, iso: string): void {
  setSetting(db, KEYS.lastSyncAt, iso);
}

/** Stamped whenever a sync gets as far as talking to the bridge. */
export function getLastAttemptAt(db: Db): string | null {
  return getSetting<string | null>(db, KEYS.lastAttemptAt, null);
}

export function setLastAttemptAt(db: Db, iso: string): void {
  setSetting(db, KEYS.lastAttemptAt, iso);
}

/** The reason the last sync failed; `null` once one succeeds. */
export function getLastError(db: Db): string | null {
  const v = getSetting<string | null>(db, KEYS.lastError, null);
  return typeof v === "string" && v ? v : null;
}

export function setLastError(db: Db, message: string | null): void {
  if (message) setSetting(db, KEYS.lastError, message);
  else deleteSetting(db, KEYS.lastError);
}

/**
 * The start of the oldest window already fetched, so a second "Load older
 * history" steps back from there instead of asking for the same span again.
 */
export function getLastWarnings(db: Db): string[] {
  return getSetting<string[]>(db, KEYS.lastWarnings, []);
}

export function setLastWarnings(db: Db, warnings: string[]): void {
  setSetting(db, KEYS.lastWarnings, warnings);
}

export function getHistoryFloor(db: Db): string | null {
  const v = getSetting<string | null>(db, KEYS.historyFloor, null);
  return typeof v === "string" && v ? v : null;
}

export function setHistoryFloor(db: Db, date: string): void {
  setSetting(db, KEYS.historyFloor, date);
}

export function getAuto(db: Db): boolean {
  return getSetting<boolean>(db, KEYS.auto, true);
}

export function setAuto(db: Db, auto: boolean): void {
  setSetting(db, KEYS.auto, auto);
}

export function getRequestState(db: Db): RequestState {
  const v = getSetting<Partial<RequestState> | null>(db, KEYS.requests, null);
  if (!v || typeof v.day !== "string" || typeof v.count !== "number")
    return EMPTY_STATE;
  return { day: v.day, count: v.count };
}

export function bumpRequests(db: Db, now: Date, n = 1): RequestState {
  const next = bump(getRequestState(db), now, n);
  setSetting(db, KEYS.requests, next);
  return next;
}

export function listLinkedAccounts(db: Db): LinkedAccount[] {
  return db
    .select()
    .from(simplefinAccounts)
    .orderBy(simplefinAccounts.orgName, simplefinAccounts.name)
    .all();
}

/** A mapped, enabled link that has never synced needs the full first window, not the overlap. */
export function hasUnsyncedMappedAccount(db: Db): boolean {
  return listLinkedAccounts(db).some(
    (l) => l.accountId !== null && l.enabled && l.lastSyncedAt === null,
  );
}

/**
 * Insert accounts SimpleFIN reports for the first time and refresh the
 * name, institution and balance of known ones; the mapping and enabled flag
 * are the user's and survive.
 */
export function upsertLinkedAccounts(db: Db, list: SfinAccount[]): void {
  for (const a of list) {
    // The balance date is the instant the bank last valued the account, so
    // it is filed under the local calendar day (transaction dates stay UTC).
    const balanceDate =
      a["balance-date"] > 0
        ? localDay(new Date(a["balance-date"] * 1000))
        : null;
    const values = {
      sfinId: a.id,
      orgName: a.org?.name?.trim() || null,
      name: a.name,
      currency: a.currency,
      balanceCents: amountToCents(a.balance),
      balanceDate,
    };
    db.insert(simplefinAccounts)
      .values(values)
      .onConflictDoUpdate({
        target: simplefinAccounts.sfinId,
        set: {
          orgName: values.orgName,
          name: values.name,
          currency: values.currency,
          balanceCents: values.balanceCents,
          balanceDate: values.balanceDate,
        },
      })
      .run();
  }
}

export function mapAccount(
  db: Db,
  sfinId: string,
  accountId: number | null,
): { ok: true } | { ok: false; error: string } {
  const linked = db
    .select()
    .from(simplefinAccounts)
    .where(eq(simplefinAccounts.sfinId, sfinId))
    .get();
  if (!linked) return { ok: false, error: "Unknown SimpleFIN account." };
  if (accountId !== null) {
    if (linked.currency !== "USD")
      return { ok: false, error: "Only USD accounts can be synced." };
    if (
      !db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .get()
    )
      return { ok: false, error: "Unknown account." };
    const taken = db
      .select({ sfinId: simplefinAccounts.sfinId })
      .from(simplefinAccounts)
      .where(
        and(
          eq(simplefinAccounts.accountId, accountId),
          ne(simplefinAccounts.sfinId, sfinId),
        ),
      )
      .get();
    if (taken)
      return {
        ok: false,
        error: "That account is already linked to another SimpleFIN account.",
      };
  }
  db.update(simplefinAccounts)
    .set({ accountId })
    .where(eq(simplefinAccounts.sfinId, sfinId))
    .run();
  return { ok: true };
}

export function setEnabled(db: Db, sfinId: string, enabled: boolean): void {
  db.update(simplefinAccounts)
    .set({ enabled })
    .where(eq(simplefinAccounts.sfinId, sfinId))
    .run();
}

export function markAccountSynced(db: Db, sfinId: string, iso: string): void {
  db.update(simplefinAccounts)
    .set({ lastSyncedAt: iso })
    .where(eq(simplefinAccounts.sfinId, sfinId))
    .run();
}

/** The earliest date any synced transaction carries; where "Load older history" continues from. */
export function earliestSyncedDate(db: Db): string | null {
  const row = db
    .select({ d: min(transactions.date) })
    .from(transactions)
    .where(isNotNull(transactions.externalId))
    .get();
  return row?.d ?? null;
}

export function getConnection(db: Db, now: Date = new Date()): Connection {
  const url = getAccessUrl(db);
  const connected = url !== null;
  const auto = getAuto(db);
  const lastAttemptAt = getLastAttemptAt(db);
  const requestsToday = countToday(getRequestState(db), now);
  const linked = listLinkedAccounts(db);
  const lastSyncAt = getLastSyncAt(db);
  // Decided here, not in the browser: the nudge only fires when the server
  // says a sync is both wanted and affordable, so a page load can never
  // start one the gate would refuse anyway.
  const stale =
    lastAttemptAt === null || hoursSince(lastAttemptAt, now) >= NUDGE_HOURS;
  return {
    connected,
    connectedAt: getSetting<string | null>(db, KEYS.connectedAt, null),
    lastSyncAt,
    lastAttemptAt,
    lastError: getLastError(db),
    auto,
    maskedUrl: url ? maskAccessUrl(url) : null,
    requestsToday,
    accounts: linked,
    earliestSynced: earliestSyncedDate(db),
    warnings: getLastWarnings(db),
    staleBanks: staleBanks(linked, lastSyncAt),
    shouldAutoSync: connected && auto && stale && requestsToday < DAILY_CAP,
  };
}
