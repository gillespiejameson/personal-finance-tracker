import { createHash } from "node:crypto";
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
} from "drizzle-orm";
import { addDays, daysBetween, localDay, localStamp } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import { accounts, imports, transactions } from "@/lib/db/schema";
import { postProcessImport } from "@/lib/import/commit";
import { dedupeHash, normalizeForHash, similarity } from "@/lib/import/dedupe";
import { recordSnapshots } from "@/lib/networth/store";
import { LIABILITY_TYPES } from "@/lib/networth/types";
import { loadAliases, resolveMerchant } from "@/lib/normalize/aliases";
import { loadCities } from "@/lib/normalize/cities";
import { canSync } from "./budget";
import { type FetchFn, fetchAccounts } from "./client";
import { amountToCents, type MappedRow, toParsedRows, utcDate } from "./map";
import {
  bumpRequests,
  earliestSyncedDate,
  getAccessUrl,
  getHistoryFloor,
  getLastAttemptAt,
  getLastSyncAt,
  getRequestState,
  hasUnsyncedMappedAccount,
  listLinkedAccounts,
  markAccountSynced,
  setHistoryFloor,
  setLastAttemptAt,
  setLastError,
  setLastSyncAt,
  setLastWarnings,
  upsertLinkedAccounts,
} from "./store";
import type {
  SfinAccount,
  SfinPayload,
  SfinTransaction,
  SyncOutcome,
  SyncResult,
  Window,
} from "./types";
import { firstWindow, nextWindows, olderWindow } from "./windows";

/** A pending row SimpleFIN stopped reporting is dropped once this old. */
export const VANISHED_PENDING_DAYS = 14;

/** Guard against an endless hunt for a free dedupe hash. */
const MAX_OCCURRENCE = 100;

export const NOT_CONNECTED_ERROR = "SimpleFIN is not connected.";
/** What a caller is told when something unforeseen broke; never the raw text. */
export const SYNC_FAILED_ERROR = "Sync failed.";
/** "Load older history" reached the end of what the bank will hand over. */
export const NO_OLDER_WARNING =
  "No older transactions available from the bank.";

/**
 * A thrown value reduced to something safe to show: no URLs (the access URL
 * is a secret and can appear in a driver's message), one line, clipped.
 */
export function plainReason(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const safe = raw
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "…")
    .replace(/\s+/g, " ")
    .trim();
  return safe.slice(0, 120) || "unknown error";
}

/**
 * Collapse repeated ids in one feed, last wins. A duplicate id would hit the
 * per-account unique index and take the whole account's transaction down.
 */
export function dedupeById(list: SfinTransaction[]): {
  txns: SfinTransaction[];
  dropped: number;
} {
  const byId = new Map<string, SfinTransaction>();
  for (const t of list) byId.set(t.id, t);
  return { txns: [...byId.values()], dropped: list.length - byId.size };
}

function importFilename(sfinId: string, tag: string): string {
  return `simplefin:${sfinId}:${tag}`;
}

/** An `imports` row for this account and sync; the filename is bumped on the rare collision. */
function createImportRow(
  tx: Db,
  accountId: number,
  sfinId: string,
  tag: string,
  rowCount: number,
  newCount: number,
): number {
  for (let n = 1; n <= 50; n++) {
    const filename = importFilename(sfinId, n === 1 ? tag : `${tag}#${n}`);
    const fileHash = createHash("sha256").update(filename).digest("hex");
    const clash = tx
      .select({ id: imports.id })
      .from(imports)
      .where(eq(imports.fileHash, fileHash))
      .get();
    if (clash) continue;
    const [row] = tx
      .insert(imports)
      .values({
        accountId,
        filename,
        fileHash,
        rowCount,
        newCount,
        dupCount: rowCount - newCount,
        // Local, like a CSV import's: staleness reads its first ten
        // characters against the user's own date.
        importedAt: localStamp(),
      })
      .returning({ id: imports.id })
      .all();
    return row.id;
  }
  throw new Error("could not allocate an imports row for the sync");
}

type ExistingRow = {
  id: number;
  externalId: string | null;
  date: string;
  amountCents: number;
  rawDescription: string;
  pending: boolean;
  dedupeHash: string;
};

function syncAccount(
  tx: Db,
  args: {
    accountId: number;
    account: SfinAccount;
    rows: MappedRow[];
    now: Date;
    importTag: string;
    window?: Window;
    /** False when the payload is too thin to prove a pending row is gone. */
    cleanup: boolean;
  },
): SyncResult {
  const { accountId, account, now } = args;
  const result: SyncResult = {
    sfinId: account.id,
    name: account.name,
    added: 0,
    updated: 0,
    matched: 0,
    pending: 0,
    removed: 0,
    balanceRecorded: false,
  };

  // Same merchant resolution as a CSV import, cities learned from these rows too.
  const aliases = loadAliases(tx);
  const cities = loadCities(
    tx,
    args.rows.map((r) => r.row.rawDescription),
  );
  const rows = args.rows.map((r) => ({
    ...r,
    row: {
      ...r.row,
      merchant: resolveMerchant(r.row.rawDescription, aliases, cities),
    },
  }));
  const incomingIds = rows.map((r) => r.externalId);

  const byExternal = new Map<string, ExistingRow>();
  if (incomingIds.length)
    for (const e of tx
      .select({
        id: transactions.id,
        externalId: transactions.externalId,
        date: transactions.date,
        amountCents: transactions.amountCents,
        rawDescription: transactions.rawDescription,
        pending: transactions.pending,
        dedupeHash: transactions.dedupeHash,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          inArray(transactions.externalId, incomingIds),
        ),
      )
      .all())
      if (e.externalId) byExternal.set(e.externalId, e);

  // Rule 2b candidates: rows without an external id near the incoming dates.
  // A CSV import of the same transaction can word it differently, so the
  // hash never matches; the feed is the bank's own record, so it claims them.
  const dates = rows.map((r) => r.row.date).sort();
  const fuzzyPool = dates.length
    ? tx
        .select({
          id: transactions.id,
          date: transactions.date,
          amountCents: transactions.amountCents,
          rawDescription: transactions.rawDescription,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, accountId),
            isNull(transactions.externalId),
            gte(transactions.date, addDays(dates[0], -3)),
            lte(transactions.date, addDays(dates[dates.length - 1], 3)),
          ),
        )
        .all()
    : [];
  // The pool was read before the exact pass, so a row an exact hash match has
  // already claimed in this batch is still in it; it must not be taken twice.
  const claimed = new Set<number>();
  const claimFuzzy = (r: MappedRow): number | null => {
    let best: { i: number; dist: number } | null = null;
    for (let i = 0; i < fuzzyPool.length; i++) {
      const c = fuzzyPool[i];
      if (claimed.has(c.id)) continue;
      if (c.amountCents !== r.row.amountCents) continue;
      const dist = Math.abs(daysBetween(c.date, r.row.date));
      if (dist > 3 || similarity(c.rawDescription, r.row.rawDescription) < 0.85)
        continue;
      // Nearest date wins, so a repeat charge does not steal its neighbour.
      if (best === null || dist < best.dist) best = { i, dist };
    }
    if (best === null) return null;
    const [c] = fuzzyPool.splice(best.i, 1);
    return c.id;
  };

  const holderOf = (hash: string) =>
    tx
      .select({ id: transactions.id, externalId: transactions.externalId })
      .from(transactions)
      .where(eq(transactions.dedupeHash, hash))
      .get();

  // Identical same-day rows get distinct occurrence numbers, exactly as a
  // CSV import numbers them, so a later file of the same rows dedupes cleanly.
  const occurrences = new Map<string, number>();
  const toInsert: { row: MappedRow; hash: string }[] = [];
  // Pass one settles every row an external id or an exact hash accounts for.
  // Whatever finds no holder waits here rather than inserting at once, so the
  // fuzzy pass below is only ever offered rows no exact match wanted.
  const unresolved: { row: MappedRow; hash: string }[] = [];
  for (const r of rows) {
    if (r.pending) result.pending++;
    const key = `${r.row.date}|${r.row.amountCents}|${normalizeForHash(r.row.rawDescription)}`;
    const k = occurrences.get(key) ?? 0;
    occurrences.set(key, k + 1);

    const existing = byExternal.get(r.externalId);
    if (existing) {
      // Rule 1: known external id → refresh the facts, keep category/review.
      const set: Partial<typeof transactions.$inferInsert> = {};
      if (existing.date !== r.row.date) set.date = r.row.date;
      if (existing.amountCents !== r.row.amountCents)
        set.amountCents = r.row.amountCents;
      if (existing.rawDescription !== r.row.rawDescription) {
        set.rawDescription = r.row.rawDescription;
        set.merchant = r.row.merchant;
      }
      if (existing.pending !== r.pending) set.pending = r.pending;
      const hash = dedupeHash(accountId, r.row, k);
      if (hash !== existing.dedupeHash) {
        const holder = holderOf(hash);
        if (!holder || holder.id === existing.id) set.dedupeHash = hash;
      }
      if (Object.keys(set).length) {
        tx.update(transactions)
          .set(set)
          .where(eq(transactions.id, existing.id))
          .run();
        if (
          set.date !== undefined ||
          set.amountCents !== undefined ||
          set.rawDescription !== undefined ||
          set.pending !== undefined
        )
          result.updated++;
      }
      continue;
    }

    // Rules 2 and 3: a row with the same dedupe hash (a CSV import of this
    // transaction) adopts the external id; otherwise the row waits for the
    // fuzzy pass. A hash already owned by a different external id means a
    // genuinely identical twin, so move on to the next occurrence number.
    let attached = false;
    for (let occ = k; occ < k + MAX_OCCURRENCE; occ++) {
      const hash = dedupeHash(accountId, r.row, occ);
      const holder = holderOf(hash);
      if (!holder) {
        unresolved.push({ row: r, hash });
        attached = true;
        break;
      }
      if (holder.externalId === null) {
        tx.update(transactions)
          .set({ externalId: r.externalId, pending: r.pending })
          .where(eq(transactions.id, holder.id))
          .run();
        claimed.add(holder.id);
        result.matched++;
        attached = true;
        break;
      }
    }
    if (!attached)
      throw new Error(`no free dedupe hash for transaction ${r.externalId}`);
  }

  // Rule 2b, pass two: what is left over may look for a differently worded
  // twin. A pending feed row is never offered one — a CSV export is older
  // than the live feed, so a row the bank still holds cannot be the posted
  // row in the file, and claiming it would flip the user's row to pending
  // for rule 5 to delete later.
  for (const entry of unresolved) {
    const r = entry.row;
    const twin = r.pending ? null : claimFuzzy(r);
    if (twin === null) {
      toInsert.push(entry);
      continue;
    }
    tx.update(transactions)
      .set({ externalId: r.externalId, pending: r.pending })
      .where(eq(transactions.id, twin))
      .run();
    // No `claimed.add`: `claimFuzzy` splices its pick out of the pool and no
    // exact match runs after this pass. The set still guards the pool against
    // the rows the exact pass claimed while they sat in it.
    result.matched++;
  }

  let freshIds: number[] = [];
  if (toInsert.length) {
    const importId = createImportRow(
      tx,
      accountId,
      account.id,
      args.importTag,
      rows.length,
      toInsert.length,
    );
    freshIds = tx
      .insert(transactions)
      .values(
        toInsert.map(({ row, hash }) => ({
          accountId,
          importId,
          date: row.row.date,
          amountCents: row.row.amountCents,
          rawDescription: row.row.rawDescription,
          merchant: row.row.merchant,
          dedupeHash: hash,
          externalId: row.externalId,
          pending: row.pending,
        })),
      )
      .returning({ id: transactions.id })
      .all()
      .map((x) => x.id);
    result.added = freshIds.length;
  }

  // Rule 4: the account's balance as of balance-date. That field is an
  // instant, not a banking day, so the snapshot is filed under its local
  // calendar day — transaction dates stay UTC because the bridge stamps
  // `posted` at UTC midnight. SimpleFIN reports a card's debt as a negative
  // balance; net worth stores what is owed as a positive number, so a
  // liability account's balance is flipped.
  const balanceCents = amountToCents(account.balance);
  if (balanceCents !== null && account["balance-date"] > 0) {
    const type = tx
      .select({ type: accounts.type })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get()?.type;
    const owed = type !== undefined && LIABILITY_TYPES.has(type);
    recordSnapshots(tx, accountId, [
      {
        date: localDay(new Date(account["balance-date"] * 1000)),
        balanceCents: owed ? -balanceCents : balanceCents,
      },
    ]);
    result.balanceRecorded = true;
  }

  // Rule 5: pending rows SimpleFIN no longer reports, once they are old
  // enough that a posted version would have shown up, within the dates this
  // payload covers. An empty or error-carrying payload proves nothing about
  // what the bank still holds, so nothing is deleted on its word.
  if (args.cleanup) {
    const cutoff = addDays(
      utcDate(now.getTime() / 1000),
      -VANISHED_PENDING_DAYS,
    );
    const vanishedConds = [
      eq(transactions.accountId, accountId),
      eq(transactions.pending, true),
      isNotNull(transactions.externalId),
      lt(transactions.date, cutoff),
    ];
    if (incomingIds.length)
      vanishedConds.push(notInArray(transactions.externalId, incomingIds));
    if (args.window) {
      vanishedConds.push(gte(transactions.date, utcDate(args.window.start)));
      vanishedConds.push(lte(transactions.date, utcDate(args.window.end - 1)));
    }
    const vanished = tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(...vanishedConds))
      .all()
      .map((x) => x.id);
    if (vanished.length) {
      tx.delete(transactions).where(inArray(transactions.id, vanished)).run();
      result.removed = vanished.length;
    }
  }

  if (result.added || result.updated || result.removed)
    postProcessImport(tx, freshIds);
  return result;
}

/**
 * Apply one `/accounts` payload: list every account it names, then upsert
 * the transactions of each mapped, enabled account in its own transaction.
 * Pure with respect to the network — `runSync` fetches, this stores.
 */
export function syncPayload(
  db: Db,
  payload: SfinPayload,
  opts: { now: Date; importTag?: string; window?: Window },
): { results: SyncResult[]; warnings: string[] } {
  const warnings = [...(payload.errors ?? [])];
  const results: SyncResult[] = [];
  const nowIso = opts.now.toISOString();
  const importTag = opts.importTag ?? nowIso;

  upsertLinkedAccounts(db, payload.accounts);
  const linked = new Map(listLinkedAccounts(db).map((l) => [l.sfinId, l]));

  for (const account of payload.accounts) {
    const link = linked.get(account.id);
    if (!link || link.accountId === null || !link.enabled) continue;
    const accountId = link.accountId;
    const { txns, dropped } = dedupeById(account.transactions ?? []);
    if (dropped > 0)
      warnings.push(
        `${account.name}: ${dropped} duplicate id${dropped === 1 ? "" : "s"} in the feed ${dropped === 1 ? "was" : "were"} collapsed`,
      );
    const { rows, skipped } = toParsedRows(txns);
    for (const s of skipped) warnings.push(`${account.name}: ${s}`);
    // One account's bad data must not cost the others their sync, so each
    // gets its own transaction and its own failure is reported, not thrown.
    try {
      const result = db.transaction((tx) =>
        syncAccount(tx as Db, {
          accountId,
          account,
          rows,
          now: opts.now,
          importTag,
          window: opts.window,
          cleanup: txns.length > 0 && (payload.errors ?? []).length === 0,
        }),
      );
      markAccountSynced(db, account.id, nowIso);
      results.push(result);
    } catch (e) {
      warnings.push(`${account.name}: sync failed — ${plainReason(e)}`);
    }
  }
  return { results, warnings };
}

function mergeInto(acc: Map<string, SyncResult>, r: SyncResult): void {
  const prev = acc.get(r.sfinId);
  if (!prev) {
    acc.set(r.sfinId, { ...r });
    return;
  }
  prev.added += r.added;
  prev.updated += r.updated;
  prev.matched += r.matched;
  prev.pending += r.pending;
  prev.removed += r.removed;
  prev.balanceRecorded = prev.balanceRecorded || r.balanceRecorded;
}

/** The date "Load older history" continues back from. */
function historyAnchor(db: Db): string | null {
  const floor = getHistoryFloor(db);
  const earliest = earliestSyncedDate(db);
  if (floor && earliest) return floor < earliest ? floor : earliest;
  return floor ?? earliest;
}

async function runWindows(
  db: Db,
  fetchFn: FetchFn,
  opts: { now: Date; automatic: boolean; olderHistory?: boolean },
): Promise<SyncOutcome> {
  const accessUrl = getAccessUrl(db);
  if (!accessUrl) return { ok: false, error: NOT_CONNECTED_ERROR };
  const lastSyncAt = getLastSyncAt(db);

  let windows: Window[];
  if (opts.olderHistory) {
    const anchor = historyAnchor(db);
    windows = [anchor ? olderWindow(anchor) : firstWindow(opts.now)];
  } else {
    // An account mapped after the connection's first sync has no history at
    // all, and the five-day overlap would never reach back for it.
    windows =
      lastSyncAt && !hasUnsyncedMappedAccount(db)
        ? nextWindows(lastSyncAt, opts.now)
        : [firstWindow(opts.now)];
  }

  const gate = canSync(getRequestState(db), opts.now, {
    automatic: opts.automatic,
    lastAttemptAt: getLastAttemptAt(db),
    needed: windows.length,
  });
  // A refusal is the budget working, not a fault: it leaves no error behind.
  if (!gate.ok) return { ok: false, error: gate.reason };

  const nowIso = opts.now.toISOString();
  setLastAttemptAt(db, nowIso);
  const merged = new Map<string, SyncResult>();
  const warnings: string[] = [];
  let requests = 0;
  let fetchedRows = 0;
  for (const w of windows) {
    const res = await fetchAccounts(fetchFn, accessUrl, w, { pending: true });
    // A request that reached the bridge counts, whatever it answered.
    if (res.ok || res.status !== undefined) {
      bumpRequests(db, opts.now, 1);
      requests++;
    }
    if (!res.ok) {
      setLastError(db, res.error);
      return { ok: false, error: res.error };
    }
    for (const a of res.payload.accounts)
      fetchedRows += a.transactions?.length ?? 0;
    const applied = syncPayload(db, res.payload, {
      now: opts.now,
      importTag: `${nowIso}:${w.start}`,
      window: w,
    });
    for (const r of applied.results) mergeInto(merged, r);
    warnings.push(...applied.warnings);
    // Remember how far back this click reached so the next one steps past it.
    if (opts.olderHistory) setHistoryFloor(db, utcDate(w.start));
  }
  if (opts.olderHistory) {
    if (fetchedRows === 0) warnings.push(NO_OLDER_WARNING);
  } else {
    setLastSyncAt(db, nowIso);
    // "Load older history" has its own one-off wording; only a regular sync
    // speaks for the connection's current state.
    setLastWarnings(db, warnings);
  }
  setLastError(db, null);
  return { ok: true, results: [...merged.values()], warnings, requests };
}

/**
 * Fetch and apply every window the connection needs: the last 90 days on a
 * first sync, an overlapping catch-up afterwards, or one older chunk for
 * "Load older history". Every request counts against the daily budget.
 *
 * Nothing thrown escapes to the caller: a sync that breaks in an unforeseen
 * way reports a flat failure rather than a message that might carry the
 * access URL.
 */
export async function runSync(
  db: Db,
  fetchFn: FetchFn,
  opts: { now: Date; automatic: boolean; olderHistory?: boolean },
): Promise<SyncOutcome> {
  try {
    return await runWindows(db, fetchFn, opts);
  } catch {
    try {
      setLastError(db, SYNC_FAILED_ERROR);
    } catch {
      // A database too broken to record the failure still owes a clean answer.
    }
    return { ok: false, error: SYNC_FAILED_ERROR };
  }
}
