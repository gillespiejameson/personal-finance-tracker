import { and, eq, sql } from "drizzle-orm";
import { daysBetween, localStamp } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import {
  accounts,
  imports,
  simplefinAccounts,
  weeklyReviews,
} from "@/lib/db/schema";
import type { AccountImportRow } from "./types";
import { staleness, weekStart } from "./weeks";

export function listWeekStarts(
  db: Db,
): { weekStart: string; completedAt: string }[] {
  return db
    .select({
      weekStart: weeklyReviews.weekStart,
      completedAt: weeklyReviews.completedAt,
    })
    .from(weeklyReviews)
    .all();
}

export function completeWeek(
  db: Db,
  today: string,
): { weekStart: string; created: boolean } {
  const ws = weekStart(today);
  const existing = db
    .select({ id: weeklyReviews.id })
    .from(weeklyReviews)
    .where(eq(weeklyReviews.weekStart, ws))
    .get();
  if (existing) return { weekStart: ws, created: false };
  // The schema default is UTC; `today` is the user's local date, and
  // `reviewStatus` compares the first 10 characters, so store a local stamp
  // whose day is the one the caller reviewed on.
  const completedAt = `${today}${localStamp().slice(10)}`;
  db.insert(weeklyReviews).values({ weekStart: ws, completedAt }).run();
  return { weekStart: ws, created: true };
}

export function accountImportRows(db: Db, today: string): AccountImportRow[] {
  const rows = db
    .select({
      id: accounts.id,
      name: accounts.name,
      color: accounts.color,
      lastImport: sql<string | null>`max(${imports.importedAt})`,
      // Only an enabled link keeps an account fresh: disconnecting disables
      // every link, and the account falls back to import staleness.
      syncedAt: sql<string | null>`max(${simplefinAccounts.lastSyncedAt})`,
    })
    .from(accounts)
    .leftJoin(imports, eq(imports.accountId, accounts.id))
    .leftJoin(
      simplefinAccounts,
      and(
        eq(simplefinAccounts.accountId, accounts.id),
        eq(simplefinAccounts.enabled, true),
      ),
    )
    .groupBy(accounts.id)
    .orderBy(accounts.id)
    .all();
  return rows.map((r) => {
    // A linked account counts as fresh from its last sync, not its last CSV.
    const stamps = [r.lastImport, r.syncedAt].filter(
      (s): s is string => s !== null,
    );
    const newest = stamps.length === 0 ? null : (stamps.sort().at(-1) ?? null);
    // Rows written before import stamps went local carry a UTC date that can
    // read as tomorrow; an import cannot be newer than today.
    const daysSince =
      newest === null
        ? null
        : Math.max(0, daysBetween(newest.slice(0, 10), today));
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      lastImport: r.lastImport,
      syncedAt: r.syncedAt,
      daysSince,
      staleness: staleness(daysSince),
    };
  });
}
