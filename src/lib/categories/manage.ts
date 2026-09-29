import { and, count, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { tombstoneSeedKey } from "@/lib/categories/ensure";
import {
  GROUP_COLORS,
  nextGroupColor,
  PARENT_COLORS,
} from "@/lib/categories/palette";
import type { Db } from "@/lib/db/client";
import {
  budgets,
  categories,
  goals,
  plannedExpenses,
  recurring,
  rules,
  transactionSplits,
  transactions,
} from "@/lib/db/schema";

export type Result = { ok: true } | { ok: false; error: string };
const SYSTEM = new Set(["Transfer", "Uncategorized"]);
/** Seed key of the group new goals are created under (`createGoal`). */
const SAVINGS_GROUP_SEED_KEY = "savings";
const SOFT_CAP = 30;

export function listCategoryTree(db: Db) {
  const all = db.select().from(categories).orderBy(categories.sort).all();
  const txnCounts = new Map(
    db
      .select({ categoryId: transactions.categoryId, n: count() })
      .from(transactions)
      .where(isNotNull(transactions.categoryId))
      .groupBy(transactions.categoryId)
      .all()
      .map((r) => [r.categoryId as number, r.n]),
  );
  const splitCounts = new Map(
    db
      .select({ categoryId: transactionSplits.categoryId, n: count() })
      .from(transactionSplits)
      .groupBy(transactionSplits.categoryId)
      .all()
      .map((r) => [r.categoryId as number, r.n]),
  );
  // Builtin rules are deliberately excluded: they exist for every seeded
  // category and would otherwise make each one look permanently in use.
  // Archiving switches them off instead (see archiveCategory).
  const ruleCounts = new Map(
    db
      .select({ categoryId: rules.categoryId, n: count() })
      .from(rules)
      .where(eq(rules.builtin, false))
      .groupBy(rules.categoryId)
      .all()
      .map((r) => [r.categoryId as number, r.n]),
  );
  const budgetCounts = new Map(
    db
      .select({ categoryId: budgets.categoryId, n: count() })
      .from(budgets)
      .groupBy(budgets.categoryId)
      .all()
      .map((r) => [r.categoryId as number, r.n]),
  );
  return all
    .filter((c) => c.parentId === null && !c.archived)
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      icon: p.icon,
      isFixed: p.isFixed,
      kind: p.kind,
      archived: p.archived,
      system: SYSTEM.has(p.name),
      leaves: all
        .filter((c) => c.parentId === p.id)
        .map((l) => {
          const txnCount = txnCounts.get(l.id) ?? 0;
          const refCount =
            txnCount +
            (splitCounts.get(l.id) ?? 0) +
            (ruleCounts.get(l.id) ?? 0) +
            (budgetCounts.get(l.id) ?? 0);
          return {
            id: l.id,
            name: l.name,
            isFixed: l.isFixed,
            rollover: l.rollover,
            archived: l.archived,
            txnCount,
            refCount,
          };
        }),
    }));
}

function leaf(db: Db, id: number) {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), isNotNull(categories.parentId)))
    .get();
}

function root(db: Db, id: number) {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.parentId)))
    .get();
}

const VALID_GROUP_COLORS = new Set(
  [...GROUP_COLORS, ...Object.values(PARENT_COLORS)].map((c) =>
    c.toLowerCase(),
  ),
);
function isValidGroupColor(color: string): boolean {
  return VALID_GROUP_COLORS.has(color.toLowerCase());
}

function activeGroups(db: Db) {
  return db
    .select()
    .from(categories)
    .where(and(isNull(categories.parentId), eq(categories.archived, false)))
    .all();
}

export function renameCategory(db: Db, id: number, name: string): Result {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40)
    return { ok: false, error: "Name must be 1–40 characters." };
  const l = leaf(db, id);
  if (!l)
    return { ok: false, error: "Only specific categories can be renamed." };
  const clash = db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.parentId, l.parentId as number),
        eq(categories.name, trimmed),
        ne(categories.id, id),
      ),
    )
    .get();
  if (clash)
    return {
      ok: false,
      error: `There is already a "${trimmed}" in this group.`,
    };
  // `seedKey` is deliberately untouched: a renamed default category keeps its
  // identity, so `ensureDefaultCategories` recognises it instead of seeding a
  // second copy under the original name.
  db.update(categories)
    .set({ name: trimmed })
    .where(eq(categories.id, id))
    .run();
  return { ok: true };
}

export function addCategory(
  db: Db,
  parentId: number,
  name: string,
  opts: { isFixed?: boolean } = {},
): { ok: true; id: number; warning?: string } | { ok: false; error: string } {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40)
    return { ok: false, error: "Name must be 1–40 characters." };
  const parent = db
    .select()
    .from(categories)
    .where(and(eq(categories.id, parentId), isNull(categories.parentId)))
    .get();
  if (!parent || SYSTEM.has(parent.name))
    return { ok: false, error: "Pick a regular group to add to." };
  const clash = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, parentId), eq(categories.name, trimmed)))
    .get();
  if (clash)
    return {
      ok: false,
      error: `There is already a "${trimmed}" in this group.`,
    };
  const maxSort = db
    .select({ s: categories.sort })
    .from(categories)
    .all()
    .reduce((m, r) => Math.max(m, r.s), 0);
  const [row] = db
    .insert(categories)
    .values({
      parentId,
      name: trimmed,
      kind: parent.kind,
      color: parent.color,
      icon: parent.icon,
      isFixed: opts.isFixed ?? parent.isFixed,
      sort: maxSort + 1,
    })
    .returning({ id: categories.id })
    .all();
  const leaves =
    db
      .select({ n: count() })
      .from(categories)
      .where(
        and(isNotNull(categories.parentId), eq(categories.archived, false)),
      )
      .get()?.n ?? 0;
  return leaves > SOFT_CAP
    ? {
        ok: true,
        id: row.id,
        warning: `That's more than ${SOFT_CAP} categories; fewer is easier to keep up with.`,
      }
    : { ok: true, id: row.id };
}

export function archiveCategory(db: Db, id: number): Result {
  if (!leaf(db, id))
    return { ok: false, error: "Only specific categories can be archived." };
  const uses = [
    [
      db
        .select({ n: count() })
        .from(transactions)
        .where(eq(transactions.categoryId, id))
        .get()?.n ?? 0,
      "transaction",
    ],
    [
      db
        .select({ n: count() })
        .from(transactionSplits)
        .where(eq(transactionSplits.categoryId, id))
        .get()?.n ?? 0,
      "split",
    ],
    [
      db
        .select({ n: count() })
        .from(rules)
        .where(and(eq(rules.categoryId, id), eq(rules.builtin, false)))
        .get()?.n ?? 0,
      "rule",
    ],
    [
      db
        .select({ n: count() })
        .from(budgets)
        .where(eq(budgets.categoryId, id))
        .get()?.n ?? 0,
      "budget",
    ],
  ] as const;
  const inUse = uses
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}${n === 1 ? "" : "s"}`);
  if (inUse.length)
    return {
      ok: false,
      error: `Still used by ${inUse.join(", ")}. Recategorize those first.`,
    };
  db.transaction((tx) => {
    // A builtin rule aimed at an archived category would keep refilling it, so
    // archiving disables those rules rather than refusing the archive.
    tx.update(rules)
      .set({ enabled: false })
      .where(and(eq(rules.categoryId, id), eq(rules.builtin, true)))
      .run();
    tx.update(categories)
      .set({ archived: true })
      .where(eq(categories.id, id))
      .run();
  });
  return { ok: true };
}

export function setCategoryFixed(db: Db, id: number, isFixed: boolean): Result {
  if (!leaf(db, id))
    return { ok: false, error: "Only specific categories can be changed." };
  db.update(categories).set({ isFixed }).where(eq(categories.id, id)).run();
  return { ok: true };
}

export function setCategoryRollover(
  db: Db,
  id: number,
  rollover: boolean,
): Result {
  if (!leaf(db, id))
    return { ok: false, error: "Only specific categories can be changed." };
  db.update(categories).set({ rollover }).where(eq(categories.id, id)).run();
  return { ok: true };
}

export function addParentCategory(
  db: Db,
  name: string,
  opts: { color?: string; isFixed?: boolean } = {},
): { ok: true; id: number } | { ok: false; error: string } {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40)
    return { ok: false, error: "Name must be 1–40 characters." };
  const groups = activeGroups(db);
  const clash = groups.find(
    (g) => g.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash)
    return {
      ok: false,
      error: `There is already a group called "${trimmed}".`,
    };
  let color: string;
  if (opts.color !== undefined) {
    if (!isValidGroupColor(opts.color))
      return { ok: false, error: "Pick a color from the palette." };
    color = opts.color;
  } else {
    color = nextGroupColor(groups.map((g) => g.color));
  }
  return db.transaction((tx) => {
    const allGroups = tx
      .select()
      .from(categories)
      .where(isNull(categories.parentId))
      .all();
    const systemGroups = allGroups.filter(
      (g) => g.kind === "transfer" || g.kind === "system",
    );
    let newSort: number;
    if (systemGroups.length > 0) {
      newSort = Math.min(...systemGroups.map((g) => g.sort));
      for (const g of systemGroups) {
        tx.update(categories)
          .set({ sort: g.sort + 1 })
          .where(eq(categories.id, g.id))
          .run();
      }
    } else {
      newSort = allGroups.reduce((m, g) => Math.max(m, g.sort), 0) + 1;
    }
    const [row] = tx
      .insert(categories)
      .values({
        parentId: null,
        name: trimmed,
        kind: "expense",
        color,
        icon: "folder",
        seedKey: null,
        isFixed: opts.isFixed ?? false,
        sort: newSort,
      })
      .returning({ id: categories.id })
      .all();
    return { ok: true, id: row.id };
  });
}

export function renameParentCategory(db: Db, id: number, name: string): Result {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40)
    return { ok: false, error: "Name must be 1–40 characters." };
  const p = root(db, id);
  if (!p) return { ok: false, error: "Only groups can be renamed." };
  if (SYSTEM.has(p.name))
    return { ok: false, error: "System groups can't be renamed." };
  const clash = activeGroups(db).find(
    (g) => g.id !== id && g.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash)
    return {
      ok: false,
      error: `There is already a group called "${trimmed}".`,
    };
  db.update(categories)
    .set({ name: trimmed })
    .where(eq(categories.id, id))
    .run();
  return { ok: true };
}

export function setParentColor(db: Db, id: number, color: string): Result {
  const p = root(db, id);
  if (!p) return { ok: false, error: "Only groups can be recolored." };
  if (SYSTEM.has(p.name))
    return { ok: false, error: "System groups can't be recolored." };
  if (!isValidGroupColor(color))
    return { ok: false, error: "Pick a color from the palette." };
  db.transaction((tx) => {
    tx.update(categories).set({ color }).where(eq(categories.id, id)).run();
    tx.update(categories)
      .set({ color })
      .where(eq(categories.parentId, id))
      .run();
  });
  return { ok: true };
}

export function archiveParentCategory(db: Db, id: number): Result {
  const p = root(db, id);
  if (!p) return { ok: false, error: "Only groups can be archived." };
  if (SYSTEM.has(p.name))
    return { ok: false, error: "System groups can't be archived." };
  const activeLeaves =
    db
      .select({ n: count() })
      .from(categories)
      .where(and(eq(categories.parentId, id), eq(categories.archived, false)))
      .get()?.n ?? 0;
  if (activeLeaves > 0)
    return { ok: false, error: "Archive its categories first." };
  db.update(categories)
    .set({ archived: true })
    .where(eq(categories.id, id))
    .run();
  return { ok: true };
}

export type CategoryReferences = {
  transactions: number;
  splits: number;
  rules: number;
  budgets: number;
  planned: number;
  goals: number;
  recurring: number;
};

/**
 * Everything that points at a category and would have to move before it can
 * go. User rules only: builtin rules exist for every seeded leaf and are
 * simply deleted with it.
 */
export function categoryReferences(db: Db, id: number): CategoryReferences {
  const n = (q: { get(): { n: number } | undefined }) => q.get()?.n ?? 0;
  return {
    transactions: n(
      db
        .select({ n: count() })
        .from(transactions)
        .where(eq(transactions.categoryId, id)),
    ),
    splits: n(
      db
        .select({ n: count() })
        .from(transactionSplits)
        .where(eq(transactionSplits.categoryId, id)),
    ),
    rules: n(
      db
        .select({ n: count() })
        .from(rules)
        .where(and(eq(rules.categoryId, id), eq(rules.builtin, false))),
    ),
    budgets: n(
      db.select({ n: count() }).from(budgets).where(eq(budgets.categoryId, id)),
    ),
    planned: n(
      db
        .select({ n: count() })
        .from(plannedExpenses)
        .where(eq(plannedExpenses.categoryId, id)),
    ),
    goals: n(
      db.select({ n: count() }).from(goals).where(eq(goals.categoryId, id)),
    ),
    recurring: n(
      db
        .select({ n: count() })
        .from(recurring)
        .where(eq(recurring.categoryId, id)),
    ),
  };
}

function totalReferences(r: CategoryReferences): number {
  return Object.values(r).reduce((a, b) => a + b, 0);
}

/**
 * Delete a leaf. With references it needs `moveTo` — another active leaf —
 * and moves every reference there in one transaction: transactions, splits,
 * user rules, planned expenses, goals and recurring rows are re-pointed;
 * budgets merge per month (the two amounts sum into `moveTo`'s row). Builtin
 * rules aimed at the leaf are deleted rather than moved, since they encode
 * the deleted category's meaning, not the user's. A seeded leaf is
 * tombstoned so `ensureDefaultCategories` never re-creates it.
 */
export function deleteCategory(
  db: Db,
  id: number,
  opts: { moveTo?: number } = {},
): Result {
  const l = leaf(db, id);
  if (!l)
    return { ok: false, error: "Only specific categories can be deleted." };
  const liveGoal = db
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.categoryId, id), eq(goals.archived, false)))
    .get();
  if (liveGoal) return { ok: false, error: "Archive the goal instead." };
  const refs = categoryReferences(db, id);
  const moveTo = opts.moveTo;
  if (totalReferences(refs) > 0 && moveTo === undefined) {
    const n = refs.transactions;
    return {
      ok: false,
      error:
        n > 0
          ? `Move its ${n} transaction${n === 1 ? "" : "s"} first.`
          : "Move what still uses it first.",
    };
  }
  if (moveTo !== undefined) {
    if (moveTo === id)
      return { ok: false, error: "Pick a different category to move to." };
    const target = leaf(db, moveTo);
    if (!target || target.archived)
      return { ok: false, error: "Pick an active category to move to." };
  }
  db.transaction((tx) => {
    if (moveTo !== undefined) {
      tx.update(transactions)
        .set({ categoryId: moveTo })
        .where(eq(transactions.categoryId, id))
        .run();
      tx.update(transactionSplits)
        .set({ categoryId: moveTo })
        .where(eq(transactionSplits.categoryId, id))
        .run();
      tx.update(rules)
        .set({ categoryId: moveTo })
        .where(and(eq(rules.categoryId, id), eq(rules.builtin, false)))
        .run();
      tx.update(plannedExpenses)
        .set({ categoryId: moveTo })
        .where(eq(plannedExpenses.categoryId, id))
        .run();
      tx.update(goals)
        .set({ categoryId: moveTo })
        .where(eq(goals.categoryId, id))
        .run();
      tx.update(recurring)
        .set({ categoryId: moveTo })
        .where(eq(recurring.categoryId, id))
        .run();
      const targetBudgets = new Map(
        tx
          .select({ id: budgets.id, month: budgets.month })
          .from(budgets)
          .where(eq(budgets.categoryId, moveTo))
          .all()
          .map((b) => [b.month, b.id]),
      );
      for (const b of tx
        .select()
        .from(budgets)
        .where(eq(budgets.categoryId, id))
        .all()) {
        const existing = targetBudgets.get(b.month);
        if (existing === undefined) {
          tx.update(budgets)
            .set({ categoryId: moveTo })
            .where(eq(budgets.id, b.id))
            .run();
        } else {
          tx.update(budgets)
            .set({
              amountCents: sql`${budgets.amountCents} + ${b.amountCents}`,
            })
            .where(eq(budgets.id, existing))
            .run();
          tx.delete(budgets).where(eq(budgets.id, b.id)).run();
        }
      }
    }
    tx.delete(rules).where(eq(rules.categoryId, id)).run();
    tx.delete(categories).where(eq(categories.id, id)).run();
    if (l.seedKey !== null) tombstoneSeedKey(tx as unknown as Db, l.seedKey);
  });
  return { ok: true };
}

/**
 * Delete a group. Only an empty one: every leaf, archived or not, must be
 * deleted (or moved) first, so nothing is ever orphaned or silently moved.
 * The savings group is the home of every goal's leaf (see `createGoal`), so
 * it stays even when empty.
 */
export function deleteParentCategory(db: Db, id: number): Result {
  const p = root(db, id);
  if (!p) return { ok: false, error: "Only groups can be deleted." };
  if (SYSTEM.has(p.name))
    return { ok: false, error: "System groups can't be deleted." };
  if (p.seedKey === SAVINGS_GROUP_SEED_KEY)
    return { ok: false, error: "Goals live here; it can't be deleted." };
  const leaves =
    db
      .select({ n: count() })
      .from(categories)
      .where(eq(categories.parentId, id))
      .get()?.n ?? 0;
  if (leaves > 0)
    return { ok: false, error: "Delete or move its categories first." };
  if (totalReferences(categoryReferences(db, id)) > 0)
    return { ok: false, error: "Move what still uses it first." };
  db.transaction((tx) => {
    tx.delete(rules).where(eq(rules.categoryId, id)).run();
    tx.delete(categories).where(eq(categories.id, id)).run();
    if (p.seedKey !== null) tombstoneSeedKey(tx as unknown as Db, p.seedKey);
  });
  return { ok: true };
}
