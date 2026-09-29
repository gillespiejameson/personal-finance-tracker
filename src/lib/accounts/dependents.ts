import { count, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  accounts,
  balanceSnapshots,
  rules,
  simplefinAccounts,
  transactions,
} from "@/lib/db/schema";

export type AccountDependents = {
  transactions: number;
  snapshots: number;
  /** User rules scoped to this account. */
  rules: number;
  /** A SimpleFIN account is mapped to this app account. */
  linked: boolean;
};

export type AccountResult = { ok: true } | { ok: false; error: string };

/** What else points at an account: shown before deleting, and gates deletion. */
export function getAccountDependents(db: Db, id: number): AccountDependents {
  const n = (v: { n: number } | undefined) => v?.n ?? 0;
  return {
    transactions: n(
      db
        .select({ n: count() })
        .from(transactions)
        .where(eq(transactions.accountId, id))
        .get(),
    ),
    snapshots: n(
      db
        .select({ n: count() })
        .from(balanceSnapshots)
        .where(eq(balanceSnapshots.accountId, id))
        .get(),
    ),
    rules: n(
      db
        .select({ n: count() })
        .from(rules)
        .where(eq(rules.accountId, id))
        .get(),
    ),
    linked:
      db
        .select({ id: simplefinAccounts.id })
        .from(simplefinAccounts)
        .where(eq(simplefinAccounts.accountId, id))
        .get() !== undefined,
  };
}

/**
 * The same answer as {@link getAccountDependents} for every account, in four
 * grouped queries instead of four per account — what the accounts list needs.
 */
export function listAccountDependents(db: Db): Map<number, AccountDependents> {
  const deps = new Map<number, AccountDependents>();
  for (const a of db.select({ id: accounts.id }).from(accounts).all())
    deps.set(a.id, {
      transactions: 0,
      snapshots: 0,
      rules: 0,
      linked: false,
    });
  for (const r of db
    .select({ id: transactions.accountId, n: count() })
    .from(transactions)
    .groupBy(transactions.accountId)
    .all()) {
    const d = deps.get(r.id);
    if (d) d.transactions = r.n;
  }
  for (const r of db
    .select({ id: balanceSnapshots.accountId, n: count() })
    .from(balanceSnapshots)
    .groupBy(balanceSnapshots.accountId)
    .all()) {
    const d = deps.get(r.id);
    if (d) d.snapshots = r.n;
  }
  for (const r of db
    .select({ id: rules.accountId, n: count() })
    .from(rules)
    .where(isNotNull(rules.accountId))
    .groupBy(rules.accountId)
    .all()) {
    const d = r.id === null ? undefined : deps.get(r.id);
    if (d) d.rules = r.n;
  }
  for (const r of db
    .select({ id: simplefinAccounts.accountId })
    .from(simplefinAccounts)
    .where(isNotNull(simplefinAccounts.accountId))
    .all()) {
    const d = r.id === null ? undefined : deps.get(r.id);
    if (d) d.linked = true;
  }
  return deps;
}
