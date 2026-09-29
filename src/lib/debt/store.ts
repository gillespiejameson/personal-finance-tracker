import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { latestBalances } from "@/lib/networth/series";
import { listSnapshots } from "@/lib/networth/store";
import { LIABILITY_TYPES } from "@/lib/networth/types";
import { getSetting, setSetting } from "@/lib/settings";
import type { DebtRow } from "./types";

const EXTRA_SETTING_KEY = "debt_extra_cents";

/** Liability accounts joined to their latest balance as of `today`. */
export function listDebtRows(db: Db, today: string): DebtRow[] {
  const rows = db
    .select({
      id: accounts.id,
      name: accounts.name,
      color: accounts.color,
      type: accounts.type,
      aprBps: accounts.aprBps,
      minPaymentCents: accounts.minPaymentCents,
    })
    .from(accounts)
    .all()
    .filter((a) => LIABILITY_TYPES.has(a.type));

  const latest = latestBalances(listSnapshots(db), today);

  return rows.map((a) => {
    const bal = latest.get(a.id);
    const balanceCents = bal?.balanceCents ?? null;
    const missing: DebtRow["missing"] =
      a.aprBps === null || a.minPaymentCents === null
        ? "terms"
        : (balanceCents ?? 0) > 0
          ? null
          : "balance";
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      type: a.type,
      balanceCents,
      asOf: bal?.date ?? null,
      aprBps: a.aprBps,
      minPaymentCents: a.minPaymentCents,
      ready: missing === null,
      missing,
    };
  });
}

export type DebtTermsResult = { ok: true } | { ok: false; error: string };

/** Set a liability account's APR (basis points, 0-10000) and minimum payment. */
export function setDebtTerms(
  db: Db,
  accountId: number,
  aprBps: number,
  minPaymentCents: number,
): DebtTermsResult {
  const [account] = db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .all();
  if (!account) return { ok: false, error: "Account not found." };
  if (!LIABILITY_TYPES.has(account.type))
    return {
      ok: false,
      error: "Only credit and loan accounts can have debt terms.",
    };
  if (!Number.isInteger(aprBps) || aprBps < 0 || aprBps > 10000)
    return { ok: false, error: "APR must be between 0% and 100%." };
  if (!Number.isInteger(minPaymentCents) || minPaymentCents < 0)
    return { ok: false, error: "Minimum payment must be zero or more." };

  db.update(accounts)
    .set({ aprBps, minPaymentCents })
    .where(eq(accounts.id, accountId))
    .run();
  return { ok: true };
}

export function getDebtExtra(db: Db): number {
  return getSetting<number>(db, EXTRA_SETTING_KEY, 0);
}

export function setDebtExtra(db: Db, cents: number): void {
  setSetting(db, EXTRA_SETTING_KEY, cents);
}
