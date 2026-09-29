import { and, eq, notExists, or, sql } from "drizzle-orm";
import { ensureDefaultCategories } from "@/lib/categories/ensure";
import type { Db } from "@/lib/db/client";
import { transactions, transferPairs } from "@/lib/db/schema";
import {
  ensureBuiltinAliases,
  reapplyMerchants,
} from "@/lib/normalize/aliases";
import { refreshRecurring } from "@/lib/recurring/refresh";
import { findRefundCandidates } from "@/lib/refunds/match";
import { ensureBuiltinRules } from "@/lib/rules/builtin";
import { applyRules } from "@/lib/rules/engine";
import { getSetting, setSetting } from "@/lib/settings";
import { applyTransfers } from "@/lib/transfers/apply";

export type RerunReport = {
  merchantsUpdated: number;
  transfersReset: number;
  paired: number;
  ruleMarked: number;
  categorized: number;
  refundsLinked: number;
  recurringDetected: number;
};

function unpairedTransferCondition(db: Db) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(transferPairs)
      .where(
        or(
          eq(transferPairs.fromTxnId, transactions.id),
          eq(transferPairs.toTxnId, transactions.id),
        ),
      ),
  );
}

/**
 * Rows marked as transfers by a rule (no pair on either side) and not since
 * confirmed by the user. A user-marked transfer (`reviewed: true`, no pair)
 * is left alone so `toggleTransfer` decisions survive a rerun.
 */
function resetRuleMarkedTransfers(db: Db): number {
  const res = db
    .update(transactions)
    .set({ isTransfer: false, categoryId: null, reviewed: false })
    .where(
      and(
        eq(transactions.isTransfer, true),
        eq(transactions.reviewed, false),
        unpairedTransferCondition(db),
      ),
    )
    .run();
  return res.changes;
}

/**
 * One-time upgrade for pre-Phase-2 data: Phase 1's `applyTransfers` set
 * `reviewed: true` on every transfer it marked, rule-marked rows included, so
 * there is no way to tell "auto-marked" from "user-confirmed" for that older
 * data. Since no Phase 1 database has ever had a UI for the user to actually
 * confirm a transfer, every unpaired transfer row from that era is legacy
 * rule-marked data — make it eligible for `resetRuleMarkedTransfers` once,
 * during the Phase 2 migration only. Never runs again after that migration.
 */
function legacyUnmarkRuleTransfers(db: Db): void {
  db.update(transactions)
    .set({ reviewed: false })
    .where(
      and(eq(transactions.isTransfer, true), unpairedTransferCondition(db)),
    )
    .run();
}

export function rerunDetection(db: Db): RerunReport {
  ensureDefaultCategories(db);
  ensureBuiltinAliases(db);
  ensureBuiltinRules(db);
  const merchantsUpdated = reapplyMerchants(db);
  const transfersReset = resetRuleMarkedTransfers(db);
  const { paired, ruleMarked } = applyTransfers(db);
  const { applied: categorized } = applyRules(db);
  const refundsLinked = findRefundCandidates(db);
  const { detected: recurringDetected } = refreshRecurring(db);
  return {
    merchantsUpdated,
    transfersReset,
    paired,
    ruleMarked,
    categorized,
    refundsLinked,
    recurringDetected,
  };
}

export function ensurePhase2(db: Db): RerunReport | null {
  if (getSetting(db, "phase2_migrated", false)) return null;
  legacyUnmarkRuleTransfers(db);
  const report = rerunDetection(db);
  setSetting(db, "phase2_migrated", true);
  return report;
}

/**
 * One-time first-run detection for existing (pre-Phase-3) databases: recurring
 * bills/income were never populated before Phase 3 introduced them, so a
 * user who already has months of data needs one seed pass rather than
 * waiting for the next mutation to trigger `refreshRecurring`.
 */
export function ensurePhase3(db: Db): number | null {
  if (getSetting(db, "phase3_recurring_seeded", false)) return null;
  const { detected } = refreshRecurring(db);
  setSetting(db, "phase3_recurring_seeded", true);
  return detected;
}

/**
 * One-time re-apply for Phase 7's rule directions: before them, the builtin
 * income rules also caught outflows with "payroll" in the description, so
 * unreviewed rows may sit in Paycheck wrongly. Their categories are rule
 * output, so recompute them from scratch — a row a rule still matches keeps
 * (or changes to) that rule's category; one nothing matches any more loses
 * its category and returns to the review queue. Reviewed rows are the user's
 * own decisions and are never touched. Returns the number of rows the pass
 * matched or cleared.
 */
export function ensurePhase7(db: Db): number | null {
  if (getSetting(db, "phase7_rules_direction_reapplied", false)) return null;
  ensureBuiltinRules(db);
  const { applied, cleared } = applyRules(db, {
    onlyUncategorized: false,
    clearUnmatched: true,
  });
  setSetting(db, "phase7_rules_direction_reapplied", true);
  return applied + cleared;
}

/**
 * One-time re-resolve after the cardholder-suffix strip (2026-09-08): the
 * credit union's SimpleFIN feed appended "<last four> - <NAME>" to every
 * card charge, so synced rows carried a different merchant from their CSV
 * twins and missed merchant rules. Re-resolve every merchant, give
 * uncategorized rows the rules they now match, and refresh bills.
 * Returns the number of merchants `reapplyMerchants` changed.
 */
export function ensurePhase9(db: Db): number | null {
  if (getSetting(db, "phase9_cardholder_suffix_stripped", false)) return null;
  ensureBuiltinAliases(db);
  const changed = reapplyMerchants(db);
  applyRules(db); // uncategorized, unreviewed rows only (the default)
  refreshRecurring(db);
  setSetting(db, "phase9_cardholder_suffix_stripped", true);
  return changed;
}
