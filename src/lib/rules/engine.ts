import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { todayIso } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import { rules, transactions } from "@/lib/db/schema";

export type RuleDirection = "in" | "out" | "any";

/** The direction a rule learned from a transaction should carry. */
export function directionOf(amountCents: number): RuleDirection {
  return amountCents < 0 ? "out" : "in";
}

/**
 * Create a user rule unless an identical enabled rule already exists; returns
 * the rule id and whether it was created. An existing rule takes on the
 * requested direction so a rule learned before directions existed (or from a
 * transaction of the other sign) follows the latest decision.
 */
export function ensureUserRule(
  db: Db,
  input: {
    pattern: string;
    field: "merchant" | "raw";
    categoryId: number;
    priority?: number;
  },
  opts: { direction?: RuleDirection } = {},
): { id: number; created: boolean } {
  const pattern = input.pattern.trim();
  const direction = opts.direction ?? "any";
  const existing = db
    .select({ id: rules.id, direction: rules.direction })
    .from(rules)
    .where(
      and(
        eq(sql`lower(${rules.pattern})`, pattern.toLowerCase()),
        eq(rules.field, input.field),
        eq(rules.categoryId, input.categoryId),
        eq(rules.matchType, "contains"),
        eq(rules.enabled, true),
      ),
    )
    .get();
  if (existing) {
    if (existing.direction !== direction)
      db.update(rules)
        .set({ direction })
        .where(eq(rules.id, existing.id))
        .run();
    return { id: existing.id, created: false };
  }
  const [row] = db
    .insert(rules)
    .values({
      pattern,
      field: input.field,
      matchType: "contains",
      priority: input.priority ?? 40,
      categoryId: input.categoryId,
      direction,
    })
    .returning({ id: rules.id })
    .all();
  return { id: row.id, created: true };
}

export type RuleRow = typeof rules.$inferSelect;
export type RuleTxn = {
  id: number;
  merchant: string;
  rawDescription: string;
  amountCents: number;
  accountId: number;
};
export type RuleSpec = {
  pattern: string;
  field: "merchant" | "raw";
  matchType: "contains" | "regex";
  minCents?: number | null;
  maxCents?: number | null;
  accountId?: number | null;
  /** Defaults to `any`. */
  direction?: RuleDirection;
};

function textMatches(
  spec: Pick<RuleSpec, "pattern" | "field" | "matchType">,
  t: RuleTxn,
): boolean {
  const hay = spec.field === "raw" ? t.rawDescription : t.merchant;
  if (spec.matchType === "regex") {
    try {
      return new RegExp(spec.pattern, "i").test(hay);
    } catch {
      return false;
    }
  }
  const escaped = spec.pattern
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9])`, "i").test(hay);
}

export function matchRule(
  rule: RuleSpec & { enabled?: boolean },
  t: RuleTxn,
): boolean {
  if (rule.enabled === false) return false;
  if (rule.direction === "in" && t.amountCents <= 0) return false;
  if (rule.direction === "out" && t.amountCents >= 0) return false;
  const abs = Math.abs(t.amountCents);
  if (rule.minCents != null && abs < rule.minCents) return false;
  if (rule.maxCents != null && abs > rule.maxCents) return false;
  if (rule.accountId != null && rule.accountId !== t.accountId) return false;
  return textMatches(rule, t);
}

export function sortRules(all: RuleRow[]): RuleRow[] {
  return all
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
}

export function pickRule(all: RuleRow[], t: RuleTxn): RuleRow | undefined {
  return sortRules(all).find((r) => matchRule(r, t));
}

/**
 * Categorize unreviewed, non-transfer rows by the first matching rule.
 * `onlyUncategorized` (default) leaves rows that already have a category
 * alone; `clearUnmatched` additionally drops the category of a row no rule
 * matches any more — only sensible when the rows' categories are known to be
 * rule-derived, as `ensurePhase7` relies on.
 */
export function applyRules(
  db: Db,
  opts: {
    transactionIds?: number[];
    onlyUncategorized?: boolean;
    clearUnmatched?: boolean;
  } = {},
): { applied: number; cleared: number } {
  const onlyUncategorized = opts.onlyUncategorized ?? true;
  const all = db.select().from(rules).all();
  const sorted = sortRules(all);
  const conds = [
    eq(transactions.isTransfer, false),
    eq(transactions.reviewed, false),
  ];
  if (onlyUncategorized) conds.push(isNull(transactions.categoryId));
  if (opts.transactionIds)
    conds.push(inArray(transactions.id, opts.transactionIds));
  const rows = db
    .select({
      id: transactions.id,
      merchant: transactions.merchant,
      rawDescription: transactions.rawDescription,
      amountCents: transactions.amountCents,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(and(...conds))
    .all();
  const today = todayIso();
  let applied = 0;
  let cleared = 0;
  db.transaction((tx) => {
    const hits = new Map<number, number>();
    for (const t of rows) {
      const r = sorted.find((r) => matchRule(r, t));
      if (!r) {
        if (opts.clearUnmatched && t.categoryId !== null) {
          tx.update(transactions)
            .set({ categoryId: null })
            .where(eq(transactions.id, t.id))
            .run();
          cleared++;
        }
        continue;
      }
      tx.update(transactions)
        .set({ categoryId: r.categoryId })
        .where(eq(transactions.id, t.id))
        .run();
      hits.set(r.id, (hits.get(r.id) ?? 0) + 1);
      applied++;
    }
    for (const [id, n] of hits)
      tx.update(rules)
        .set({ hitCount: sql`${rules.hitCount} + ${n}`, lastHit: today })
        .where(eq(rules.id, id))
        .run();
  });
  return { applied, cleared };
}

export function previewRule(db: Db, spec: RuleSpec): number {
  const rows = db
    .select({
      id: transactions.id,
      merchant: transactions.merchant,
      rawDescription: transactions.rawDescription,
      amountCents: transactions.amountCents,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(eq(transactions.isTransfer, false))
    .all();
  return rows.filter((t) => matchRule(spec, t)).length;
}
