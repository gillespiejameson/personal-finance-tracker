import { count, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  accounts,
  balanceSnapshots,
  imports,
  rules,
  transactions,
} from "@/lib/db/schema";
import type { AccountResult } from "./dependents";

export type DeleteAccountResult = AccountResult;

/**
 * Delete an account that holds no transactions. Everything else an empty
 * account can own goes with it: empty `imports` rows, balance snapshots and
 * the user rules scoped to it (deleted, never widened to every account). A
 * SimpleFIN link to it becomes unmapped through its `on delete set null`.
 * An account with transactions is refused so removal stays reversible.
 */
export function deleteAccountIfEmpty(db: Db, id: number): DeleteAccountResult {
  return db.transaction((tx) => {
    const n =
      tx
        .select({ n: count() })
        .from(transactions)
        .where(eq(transactions.accountId, id))
        .get()?.n ?? 0;
    if (n > 0)
      return {
        ok: false as const,
        error: `Account has ${n} transactions and can't be deleted.`,
      };
    tx.delete(rules).where(eq(rules.accountId, id)).run();
    tx.delete(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).run();
    tx.delete(imports).where(eq(imports.accountId, id)).run();
    tx.delete(accounts).where(eq(accounts.id, id)).run();
    return { ok: true as const };
  });
}
