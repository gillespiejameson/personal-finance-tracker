import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { addDays, localStamp } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import { imports, transactions, transferPairs } from "@/lib/db/schema";
import { snapshotsFromRows } from "@/lib/networth/snapshots";
import { recordSnapshots } from "@/lib/networth/store";
import { loadAliases, resolveMerchant } from "@/lib/normalize/aliases";
import { loadCities } from "@/lib/normalize/cities";
import { refreshRecurring } from "@/lib/recurring/refresh";
import { findRefundCandidates } from "@/lib/refunds/match";
import { applyRules } from "@/lib/rules/engine";
import { applyTransfers } from "@/lib/transfers/apply";
import {
  dedupeHash,
  fileHash,
  findFuzzyDuplicates,
  normalizeForHash,
} from "./dedupe";
import type { ParsedRow } from "./types";

export function commitImport(
  db: Db,
  args: {
    accountId: number;
    filename: string;
    text: string;
    rows: ParsedRow[];
    backupPath?: string | null;
  },
) {
  const fh = fileHash(args.text);
  if (
    db
      .select({ id: imports.id })
      .from(imports)
      .where(eq(imports.fileHash, fh))
      .get()
  )
    throw new Error("already-imported");

  const aliases = loadAliases(db);
  // Learned once per import, counting this file's own rows as well, so the
  // very first import cleans city names the same way later ones will.
  const cities = loadCities(
    db,
    args.rows.map((r) => r.rawDescription),
  );
  const rows = args.rows.map((r) => ({
    ...r,
    merchant: resolveMerchant(r.rawDescription, aliases, cities),
  }));

  const occurrences = new Map<string, number>();
  const hashed = rows.map((row) => {
    const key = `${row.date}|${row.amountCents}|${normalizeForHash(row.rawDescription)}`;
    const k = occurrences.get(key) ?? 0;
    occurrences.set(key, k + 1);
    return { row, hash: dedupeHash(args.accountId, row, k) };
  });
  const existingHashes = new Set(
    db
      .select({ h: transactions.dedupeHash })
      .from(transactions)
      .where(
        inArray(
          transactions.dedupeHash,
          hashed.map((h) => h.hash),
        ),
      )
      .all()
      .map((x) => x.h),
  );
  const seen = new Set<string>();
  const fresh = hashed.filter(({ hash }) => {
    if (existingHashes.has(hash) || seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
  const dupCount = hashed.length - fresh.length;

  const dates = fresh.map((f) => f.row.date).sort();
  const existing = dates.length
    ? db
        .select({
          id: transactions.id,
          date: transactions.date,
          amountCents: transactions.amountCents,
          rawDescription: transactions.rawDescription,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, args.accountId),
            gte(transactions.date, addDays(dates[0], -3)),
            lte(transactions.date, addDays(dates[dates.length - 1], 3)),
          ),
        )
        .all()
    : [];
  const fuzzy = findFuzzyDuplicates(
    fresh.map((f) => f.row),
    existing,
  );

  return db.transaction((tx) => {
    const [imp] = tx
      .insert(imports)
      .values({
        accountId: args.accountId,
        filename: args.filename,
        fileHash: fh,
        rowCount: args.rows.length,
        newCount: fresh.length,
        dupCount,
        flaggedCount: fuzzy.size,
        backupPath: args.backupPath ?? null,
        // The schema default is UTC; staleness compares this against a local
        // date, so an evening import must not be stamped tomorrow.
        importedAt: localStamp(),
      })
      .returning({ id: imports.id })
      .all();
    let freshIds: number[] = [];
    if (fresh.length) {
      freshIds = tx
        .insert(transactions)
        .values(
          fresh.map(({ row, hash }, i) => ({
            accountId: args.accountId,
            importId: imp.id,
            date: row.date,
            amountCents: row.amountCents,
            rawDescription: row.rawDescription,
            merchant: row.merchant,
            dedupeHash: hash,
            possibleDuplicate: fuzzy.has(i),
          })),
        )
        .returning({ id: transactions.id })
        .all()
        .map((x) => x.id);
    }
    // Record end-of-day balances for every parsed row, including duplicates,
    // so re-importing a fresh download refreshes balances even when it adds
    // no new transactions.
    recordSnapshots(
      tx as unknown as Db,
      args.accountId,
      snapshotsFromRows(args.rows),
    );
    const { categorized } = postProcessImport(tx as unknown as Db, freshIds);
    return {
      importId: imp.id,
      newCount: fresh.length,
      dupCount,
      flaggedCount: fuzzy.size,
      categorized,
    };
  });
}

/**
 * What every import runs after its rows land, whether they came from a file
 * or a SimpleFIN sync: pair transfers, then categorize and refund-link the
 * fresh rows so they land categorized rather than waiting for a manual re-run
 * (both helpers skip rows applyTransfers has just marked as transfers), and
 * refresh recurring detection. Call it inside the import's transaction.
 */
export function postProcessImport(
  db: Db,
  freshIds: number[],
): { categorized: number } {
  applyTransfers(db);
  const { applied: categorized } = freshIds.length
    ? applyRules(db, { transactionIds: freshIds })
    : { applied: 0 };
  if (freshIds.length) findRefundCandidates(db, { transactionIds: freshIds });
  refreshRecurring(db);
  return { categorized };
}

export function undoImport(db: Db, importId: number): number {
  return db.transaction((tx) => {
    const ids = tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.importId, importId))
      .all()
      .map((x) => x.id);
    if (ids.length === 0) {
      tx.delete(imports).where(eq(imports.id, importId)).run();
      return 0;
    }
    const pairs = tx
      .select()
      .from(transferPairs)
      .where(
        or(
          inArray(transferPairs.fromTxnId, ids),
          inArray(transferPairs.toTxnId, ids),
        ),
      )
      .all();
    const partners = pairs
      .flatMap((p) => [p.fromTxnId, p.toTxnId])
      .filter((id) => !ids.includes(id));
    tx.delete(imports).where(eq(imports.id, importId)).run(); // cascades transactions + pairs
    if (partners.length)
      tx.update(transactions)
        .set({ isTransfer: false, categoryId: null, reviewed: false })
        .where(inArray(transactions.id, partners))
        .run();
    return ids.length;
  });
}
