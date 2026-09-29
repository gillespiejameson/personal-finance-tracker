import { eq, sql } from "drizzle-orm";
import type { AccountRecord } from "@/lib/accounts/schema";
import type { Db } from "@/lib/db/client";
import { accounts, balanceSnapshots } from "@/lib/db/schema";
import { LIABILITY_TYPES } from "@/lib/networth/types";
import type { AccountResult } from "./dependents";

/**
 * Edit an account's name, type, institution and color. Debt terms belong to
 * the Debt page and are left alone. Snapshots store an asset's balance as is
 * and a liability's as the amount owed, so a change of kind negates them to
 * keep their meaning.
 */
export function updateAccountRecord(
  db: Db,
  id: number,
  input: AccountRecord,
): AccountResult {
  return db.transaction((tx) => {
    const current = tx
      .select({ type: accounts.type })
      .from(accounts)
      .where(eq(accounts.id, id))
      .get();
    if (!current) return { ok: false as const, error: "Account not found." };
    tx.update(accounts)
      .set({
        name: input.name,
        type: input.type,
        institution: input.institution,
        color: input.color,
      })
      .where(eq(accounts.id, id))
      .run();
    const wasLiability = LIABILITY_TYPES.has(current.type);
    const isLiability = LIABILITY_TYPES.has(input.type);
    if (wasLiability !== isLiability)
      tx.update(balanceSnapshots)
        .set({ balanceCents: sql`-${balanceSnapshots.balanceCents}` })
        .where(eq(balanceSnapshots.accountId, id))
        .run();
    return { ok: true as const };
  });
}
