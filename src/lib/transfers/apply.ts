import { and, eq, inArray, notExists, or, sql } from "drizzle-orm";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import type { Db } from "@/lib/db/client";
import { accounts, transactions, transferPairs } from "@/lib/db/schema";
import { isOwnTransfer, pairTransfers } from "./detect";

export function applyTransfers(
  db: Db,
  accountIds?: number[],
): { paired: number; ruleMarked: number } {
  if (accountIds !== undefined && accountIds.length === 0) {
    return { paired: 0, ruleMarked: 0 };
  }

  return db.transaction((tx) => {
    ensureDefaultCategories(tx as Db);
    const transferCat = findCategoryId(tx as Db, "Transfer");
    if (transferCat === undefined) {
      throw new Error("Transfer category missing");
    }

    /*
     * A row stays a pairing candidate for as long as it has no transfer_pairs
     * row on either side. That deliberately includes rows an earlier import
     * already rule-marked as transfers (`is_transfer = true`, e.g. "ONLINE
     * TRANSFER TO ALLY SAVINGS"): the other leg of such a transfer usually
     * arrives with a later statement, and if rule-marked rows were excluded
     * the two sides could never be linked. Rows that already sit in a pair are
     * excluded, so re-running never creates a second pair for them.
     */
    const unpaired = notExists(
      tx
        .select({ one: sql`1` })
        .from(transferPairs)
        .where(
          or(
            eq(transferPairs.fromTxnId, transactions.id),
            eq(transferPairs.toTxnId, transactions.id),
          ),
        ),
    );
    const where =
      accountIds !== undefined
        ? and(unpaired, inArray(transactions.accountId, accountIds))
        : unpaired;
    const rows = tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountType: accounts.type,
        date: transactions.date,
        amountCents: transactions.amountCents,
        rawDescription: transactions.rawDescription,
        isTransfer: transactions.isTransfer,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(where)
      .all();

    // Candidacy is decided by the query above, so every row is offered to the
    // matcher regardless of a rule mark it may already carry.
    const pairs = pairTransfers(rows.map((r) => ({ ...r, isTransfer: false })));
    // Paired rows are confirmed by matching both legs, so they're marked
    // reviewed. Rule-marked rows are only a guess and stay unreviewed so a
    // later rerunDetection can un-mark them if the rule no longer applies —
    // unless the user has since confirmed the mark themselves (reviewed:
    // true), which rerunDetection then leaves alone.
    const mark = (ids: number[], reviewed: boolean) => {
      if (ids.length === 0) return;
      tx.update(transactions)
        .set({ isTransfer: true, categoryId: transferCat, reviewed })
        .where(inArray(transactions.id, ids))
        .run();
    };

    for (const p of pairs) {
      tx.insert(transferPairs)
        .values({
          fromTxnId: p.fromId,
          toTxnId: p.toId,
          confidence: p.confidence,
        })
        .run();
    }
    mark(
      pairs.flatMap((p) => [p.fromId, p.toId]),
      true,
    );

    const pairedIds = new Set(pairs.flatMap((p) => [p.fromId, p.toId]));
    // Only rows newly marked by this run are counted; a row an earlier run
    // already flagged is not marked again.
    const ruleIds = rows
      .filter(
        (r) =>
          !r.isTransfer &&
          !pairedIds.has(r.id) &&
          isOwnTransfer(r.rawDescription, r.accountType),
      )
      .map((r) => r.id);
    mark(ruleIds, false);

    return { paired: pairs.length, ruleMarked: ruleIds.length };
  });
}
