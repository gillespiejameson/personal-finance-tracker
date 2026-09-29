import type { Db } from "@/lib/db/client";
import { balanceSnapshots } from "@/lib/db/schema";
import type { Snapshot } from "./types";

/** Upsert one snapshot per date, e.g. for every parsed row of a fresh import (duplicates included). */
export function recordSnapshots(
  db: Db,
  accountId: number,
  snapshots: Snapshot[],
): void {
  for (const s of snapshots) setBalance(db, accountId, s.date, s.balanceCents);
}

/** Upsert a single manually-entered balance. */
export function setBalance(
  db: Db,
  accountId: number,
  date: string,
  balanceCents: number,
): void {
  db.insert(balanceSnapshots)
    .values({ accountId, date, balanceCents })
    .onConflictDoUpdate({
      target: [balanceSnapshots.accountId, balanceSnapshots.date],
      set: { balanceCents },
    })
    .run();
}

export function listSnapshots(
  db: Db,
): { accountId: number; date: string; balanceCents: number }[] {
  return db
    .select({
      accountId: balanceSnapshots.accountId,
      date: balanceSnapshots.date,
      balanceCents: balanceSnapshots.balanceCents,
    })
    .from(balanceSnapshots)
    .all();
}
