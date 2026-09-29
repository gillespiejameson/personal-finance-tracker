import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listBudgetLeaves } from "@/lib/budget/store";
import {
  DELETED_SEED_KEYS,
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import {
  addCategory,
  addParentCategory,
  archiveCategory,
  archiveParentCategory,
  categoryReferences,
  deleteCategory,
  deleteParentCategory,
  listCategoryTree,
  renameCategory,
  renameParentCategory,
  setCategoryFixed,
  setParentColor,
} from "@/lib/categories/manage";
import { GROUP_COLORS } from "@/lib/categories/palette";
import { openDb } from "@/lib/db/client";
import {
  accounts,
  budgets,
  categories,
  goals,
  plannedExpenses,
  recurring,
  rules,
  transactionSplits,
  transactions,
} from "@/lib/db/schema";
import { commitImport } from "@/lib/import/commit";
import { rerunDetection } from "@/lib/maintenance/rerun";
import { BUILTIN_RULES, ensureBuiltinRules } from "@/lib/rules/builtin";
import { getSetting } from "@/lib/settings";
import { mustFind } from "../helpers";

describe("category management", () => {
  it("lists the tree, renames, adds, archives with guards, toggles fixed", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const tree = listCategoryTree(db);
    expect(tree.map((p) => p.name)).toContain("Food");
    const food = mustFind(tree, (p) => p.name === "Food");
    const groceries = mustFind(food.leaves, (l) => l.name === "Groceries");

    expect(renameCategory(db, groceries.id, "Grocery stores")).toEqual({
      ok: true,
    });
    expect(renameCategory(db, groceries.id, "Restaurants")).toMatchObject({
      ok: false,
    }); // sibling clash
    expect(renameCategory(db, food.id, "Meals")).toMatchObject({ ok: false }); // parent

    const added = addCategory(db, food.id, "Snacks");
    expect(added).toMatchObject({ ok: true });
    const transfer = mustFind(tree, (p) => p.name === "Transfer");
    expect(addCategory(db, transfer.id, "Nope")).toMatchObject({ ok: false });

    const [a] = db
      .insert(accounts)
      .values({ name: "A", type: "checking" })
      .returning()
      .all();
    db.insert(transactions)
      .values({
        accountId: a.id,
        date: "2026-06-01",
        amountCents: -100,
        rawDescription: "X",
        merchant: "X",
        dedupeHash: "x",
        categoryId: groceries.id,
      })
      .run();

    // Test refCount: insert a rule for Restaurants (no txn, but 1 refCount)
    const restaurants = mustFind(food.leaves, (l) => l.name === "Restaurants");
    db.insert(rules).values({ pattern: "x", categoryId: restaurants.id }).run();
    const treeAfterRule = listCategoryTree(db);
    const foodAfterRule = mustFind(treeAfterRule, (p) => p.name === "Food");
    const restaurantsAfterRule = mustFind(
      foodAfterRule.leaves,
      (l) => l.name === "Restaurants",
    );
    expect(restaurantsAfterRule.refCount).toBe(1);
    expect(restaurantsAfterRule.txnCount).toBe(0);

    expect(archiveCategory(db, groceries.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining("1 transaction"),
    });
    if (!added.ok) throw new Error("add failed");
    expect(archiveCategory(db, added.id)).toEqual({ ok: true });
    expect(
      mustFind(listCategoryTree(db), (p) => p.name === "Food").leaves.find(
        (l) => l.name === "Snacks",
      )?.archived,
    ).toBe(true);

    expect(setCategoryFixed(db, groceries.id, true)).toEqual({ ok: true });
    expect(
      mustFind(
        mustFind(listCategoryTree(db), (p) => p.name === "Food").leaves,
        (l) => l.id === groceries.id,
      ).isFixed,
    ).toBe(true);

    // soft cap: 27 leaves seeded; add until > 30
    for (const n of ["A1", "A2", "A3"]) addCategory(db, food.id, n);
    const over = addCategory(db, food.id, "A4");
    expect(over).toMatchObject({
      ok: true,
      warning: expect.stringContaining("30"),
    });
    expect(findCategoryId(db, "A4")).toBeTypeOf("number");
  });

  it("archives past builtin rules by disabling them, not by refusing", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinRules(db);
    const gym = findCategoryId(db, "Gym & memberships") as number;
    const builtinForGym = db
      .select()
      .from(rules)
      .all()
      .filter((r) => r.categoryId === gym);
    expect(builtinForGym.length).toBeGreaterThan(0);
    expect(builtinForGym.every((r) => r.builtin && r.enabled)).toBe(true);

    // Builtin rules do not count as references...
    const leaf = mustFind(
      mustFind(listCategoryTree(db), (p) => p.name === "Bills & Subscriptions")
        .leaves,
      (l) => l.id === gym,
    );
    expect(leaf.refCount).toBe(0);

    // ...so the archive goes through, switching those rules off.
    expect(archiveCategory(db, gym)).toEqual({ ok: true });
    expect(
      db
        .select()
        .from(rules)
        .all()
        .filter((r) => r.categoryId === gym)
        .every((r) => !r.enabled),
    ).toBe(true);

    // A user rule still blocks it.
    const hobbies = findCategoryId(db, "Hobbies") as number;
    db.insert(rules)
      .values({ pattern: "yarn", categoryId: hobbies, builtin: false })
      .run();
    expect(archiveCategory(db, hobbies)).toMatchObject({
      ok: false,
      error: expect.stringContaining("1 rule"),
    });
  });
});

describe("parent category (group) management", () => {
  it("adds a group before the system groups, after the last seeded expense group, with the first unused color", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const added = addParentCategory(db, "Pets");
    expect(added).toMatchObject({ ok: true });
    if (!added.ok) throw new Error("add failed");

    const tree = listCategoryTree(db);
    const names = tree.map((p) => p.name);
    const petsIdx = names.indexOf("Pets");
    const savingsIdx = names.indexOf("Savings & Investing");
    const transferIdx = names.indexOf("Transfer");
    const uncategorizedIdx = names.indexOf("Uncategorized");
    expect(petsIdx).toBe(savingsIdx + 1);
    expect(petsIdx).toBeLessThan(transferIdx);
    expect(transferIdx).toBeLessThan(uncategorizedIdx);

    const pets = mustFind(tree, (p) => p.name === "Pets");
    expect(pets.color).toBe(GROUP_COLORS[0]);
    expect(pets.kind).toBe("expense");
    expect(pets.system).toBe(false);
    expect(pets.archived).toBe(false);
  });

  it("assigns the next unused color to subsequent groups and refuses a name clash", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const first = addParentCategory(db, "Pets");
    if (!first.ok) throw new Error("add failed");
    const second = addParentCategory(db, "Hobbies extra");
    if (!second.ok) throw new Error("add failed");
    const tree = listCategoryTree(db);
    expect(mustFind(tree, (p) => p.name === "Hobbies extra").color).toBe(
      GROUP_COLORS[1],
    );

    expect(addParentCategory(db, "pets")).toMatchObject({
      ok: false,
      error: expect.stringContaining("already a group"),
    });
    expect(addParentCategory(db, "Food")).toMatchObject({ ok: false });
  });

  it("refuses an out-of-palette color and accepts a chosen palette color", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    expect(addParentCategory(db, "Pets", { color: "#123456" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("palette"),
    });
    const withColor = addParentCategory(db, "Pets", {
      color: GROUP_COLORS[3],
    });
    expect(withColor).toMatchObject({ ok: true });
    if (!withColor.ok) throw new Error("add failed");
    expect(
      mustFind(listCategoryTree(db), (p) => p.id === withColor.id).color,
    ).toBe(GROUP_COLORS[3]);
  });

  it("renames a group, refuses clashes and system groups", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const added = addParentCategory(db, "Pets");
    if (!added.ok) throw new Error("add failed");

    expect(renameParentCategory(db, added.id, "Animals")).toEqual({
      ok: true,
    });
    expect(mustFind(listCategoryTree(db), (p) => p.id === added.id).name).toBe(
      "Animals",
    );

    expect(renameParentCategory(db, added.id, "Food")).toMatchObject({
      ok: false,
    });

    const transfer = mustFind(
      listCategoryTree(db),
      (p) => p.name === "Transfer",
    );
    expect(renameParentCategory(db, transfer.id, "Moves")).toMatchObject({
      ok: false,
    });
  });

  it("recolors a group and its leaves together, palette-constrained", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const added = addParentCategory(db, "Pets");
    if (!added.ok) throw new Error("add failed");
    const leafAdd = addCategory(db, added.id, "Vet");
    expect(leafAdd).toMatchObject({ ok: true });
    if (!leafAdd.ok) throw new Error("leaf add failed");

    expect(setParentColor(db, added.id, "#000000")).toMatchObject({
      ok: false,
    });
    expect(setParentColor(db, added.id, GROUP_COLORS[5])).toEqual({
      ok: true,
    });

    const pets = mustFind(listCategoryTree(db), (p) => p.id === added.id);
    expect(pets.color).toBe(GROUP_COLORS[5]);
    const vetRow = db
      .select()
      .from(categories)
      .where(eq(categories.id, leafAdd.id))
      .get();
    expect(vetRow?.color).toBe(GROUP_COLORS[5]);

    const transfer = mustFind(
      listCategoryTree(db),
      (p) => p.name === "Transfer",
    );
    expect(setParentColor(db, transfer.id, GROUP_COLORS[0])).toMatchObject({
      ok: false,
    });
  });

  it("refuses to archive a group with active leaves, allows it once empty, and hides it from the tree", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const added = addParentCategory(db, "Pets");
    if (!added.ok) throw new Error("add failed");
    const leafAdd = addCategory(db, added.id, "Vet");
    if (!leafAdd.ok) throw new Error("leaf add failed");

    expect(archiveParentCategory(db, added.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Archive its categories first"),
    });

    expect(archiveCategory(db, leafAdd.id)).toEqual({ ok: true });
    expect(archiveParentCategory(db, added.id)).toEqual({ ok: true });
    expect(listCategoryTree(db).find((p) => p.id === added.id)).toBeUndefined();

    const transfer = mustFind(
      listCategoryTree(db),
      (p) => p.name === "Transfer",
    );
    expect(archiveParentCategory(db, transfer.id)).toMatchObject({
      ok: false,
    });
  });

  it("leaves added under a new group inherit its color and show up as budgetable, non-savings leaves", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const added = addParentCategory(db, "Pets");
    if (!added.ok) throw new Error("add failed");
    const leafAdd = addCategory(db, added.id, "Vet");
    if (!leafAdd.ok) throw new Error("leaf add failed");

    const pets = mustFind(listCategoryTree(db), (p) => p.id === added.id);
    const vet = mustFind(pets.leaves, (l) => l.id === leafAdd.id);
    expect(vet).toBeTruthy();

    const budgetLeaf = mustFind(
      listBudgetLeaves(db),
      (l) => l.id === leafAdd.id,
    );
    expect(budgetLeaf.parentName).toBe("Pets");
    expect(budgetLeaf.color).toBe(pets.color);
    expect(budgetLeaf.isSavings).toBe(false);
  });
});

describe("deleteCategory", () => {
  /** Groceries with one of every reference kind; Restaurants as the move target. */
  function referenced() {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinRules(db);
    const groceries = findCategoryId(db, "Groceries") as number;
    const restaurants = findCategoryId(db, "Restaurants") as number;
    const [a] = db
      .insert(accounts)
      .values({ name: "A", type: "checking" })
      .returning()
      .all();
    const [t1, t2] = db
      .insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-06-01",
          amountCents: -100,
          rawDescription: "X",
          merchant: "X",
          dedupeHash: "x1",
          categoryId: groceries,
        },
        {
          accountId: a.id,
          date: "2026-06-02",
          amountCents: -200,
          rawDescription: "Y",
          merchant: "Y",
          dedupeHash: "x2",
          categoryId: groceries,
        },
      ])
      .returning({ id: transactions.id })
      .all();
    db.insert(transactionSplits)
      .values({ transactionId: t2.id, categoryId: groceries, amountCents: -50 })
      .run();
    db.insert(rules)
      .values({ pattern: "aldi", categoryId: groceries, builtin: false })
      .run();
    db.insert(budgets)
      .values([
        { month: "2026-06", categoryId: groceries, amountCents: 30_000 },
        { month: "2026-07", categoryId: groceries, amountCents: 31_000 },
        { month: "2026-06", categoryId: restaurants, amountCents: 10_000 },
      ])
      .run();
    db.insert(plannedExpenses)
      .values({
        name: "Thanksgiving",
        amountCents: 20_000,
        dueDate: "2026-11-20",
        every: "year",
        categoryId: groceries,
      })
      .run();
    db.insert(recurring)
      .values({
        merchant: "Aldi",
        cadence: "weekly",
        categoryId: groceries,
        avgCents: -5_000,
        intervalDays: 7,
        lastSeen: "2026-06-01",
        nextExpected: "2026-06-08",
      })
      .run();
    db.insert(goals)
      .values({
        name: "Old goal",
        targetCents: 1_000,
        categoryId: groceries,
        archived: true,
      })
      .run();
    return { db, groceries, restaurants, t1, t2 };
  }

  it("counts every reference kind, excluding builtin rules", () => {
    const { db, groceries } = referenced();
    expect(categoryReferences(db, groceries)).toEqual({
      transactions: 2,
      splits: 1,
      rules: 1,
      budgets: 2,
      planned: 1,
      goals: 1,
      recurring: 1,
    });
    expect(
      db
        .select()
        .from(rules)
        .all()
        .filter((r) => r.categoryId === groceries && r.builtin).length,
    ).toBeGreaterThan(0);
  });

  it("refuses a referenced leaf without a destination, naming the transaction count", () => {
    const { db, groceries } = referenced();
    expect(deleteCategory(db, groceries)).toEqual({
      ok: false,
      error: "Move its 2 transactions first.",
    });
    expect(findCategoryId(db, "Groceries")).toBe(groceries);
  });

  it("moves all seven reference kinds, merges budgets per month, drops builtin rules and the row", () => {
    const { db, groceries, restaurants, t1, t2 } = referenced();
    expect(deleteCategory(db, groceries, { moveTo: restaurants })).toEqual({
      ok: true,
    });
    expect(findCategoryId(db, "Groceries")).toBeUndefined();

    const txns = db.select().from(transactions).all();
    expect(
      txns
        .filter((t) => [t1.id, t2.id].includes(t.id))
        .map((t) => t.categoryId),
    ).toEqual([restaurants, restaurants]);
    expect(
      db
        .select()
        .from(transactionSplits)
        .all()
        .map((s) => s.categoryId),
    ).toEqual([restaurants]);

    const allRules = db.select().from(rules).all();
    expect(allRules.some((r) => r.categoryId === groceries)).toBe(false);
    const aldi = mustFind(allRules, (r) => r.pattern === "aldi");
    expect(aldi.categoryId).toBe(restaurants);
    expect(aldi.builtin).toBe(false);

    const budgetRows = db
      .select()
      .from(budgets)
      .all()
      .map((b) => [b.month, b.categoryId, b.amountCents])
      .sort();
    expect(budgetRows).toEqual([
      ["2026-06", restaurants, 40_000],
      ["2026-07", restaurants, 31_000],
    ]);

    expect(
      db
        .select()
        .from(plannedExpenses)
        .all()
        .map((p) => p.categoryId),
    ).toEqual([restaurants]);
    expect(
      db
        .select()
        .from(recurring)
        .all()
        .map((r) => r.categoryId),
    ).toEqual([restaurants]);
    expect(
      db
        .select()
        .from(goals)
        .all()
        .map((g) => g.categoryId),
    ).toEqual([restaurants]);
    expect(categoryReferences(db, restaurants)).toEqual({
      transactions: 2,
      splits: 1,
      rules: 1,
      budgets: 2,
      planned: 1,
      goals: 1,
      recurring: 1,
    });
    expect(getSetting<string[]>(db, DELETED_SEED_KEYS, [])).toEqual([
      "food/groceries",
    ]);
  });

  it("deletes an unreferenced leaf outright, dropping its builtin rules", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinRules(db);
    const gym = findCategoryId(db, "Gym & memberships") as number;
    expect(deleteCategory(db, gym)).toEqual({ ok: true });
    expect(findCategoryId(db, "Gym & memberships")).toBeUndefined();
    expect(
      db
        .select()
        .from(rules)
        .all()
        .some((r) => r.categoryId === gym),
    ).toBe(false);
    // A user-made leaf leaves no tombstone behind.
    const food = mustFind(listCategoryTree(db), (p) => p.name === "Food");
    const snacks = addCategory(db, food.id, "Snacks");
    if (!snacks.ok) throw new Error("add failed");
    expect(deleteCategory(db, snacks.id)).toEqual({ ok: true });
    expect(getSetting<string[]>(db, DELETED_SEED_KEYS, [])).toEqual([
      "bills/gym-memberships",
    ]);
  });

  it("refuses bad targets: itself, a group, an archived leaf, a missing leaf, and groups as the subject", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const groceries = findCategoryId(db, "Groceries") as number;
    const restaurants = findCategoryId(db, "Restaurants") as number;
    const food = mustFind(listCategoryTree(db), (p) => p.name === "Food");
    expect(archiveCategory(db, restaurants)).toEqual({ ok: true });
    expect(deleteCategory(db, groceries, { moveTo: groceries })).toMatchObject({
      ok: false,
    });
    expect(deleteCategory(db, groceries, { moveTo: food.id })).toMatchObject({
      ok: false,
    });
    expect(
      deleteCategory(db, groceries, { moveTo: restaurants }),
    ).toMatchObject({ ok: false });
    expect(deleteCategory(db, groceries, { moveTo: 999_999 })).toMatchObject({
      ok: false,
    });
    expect(deleteCategory(db, food.id)).toMatchObject({ ok: false });
    expect(deleteCategory(db, 999_999)).toMatchObject({ ok: false });
  });

  it("leaves builtin rules, rerun and import working once a seeded leaf is gone", () => {
    const { db, groceries, restaurants } = referenced();
    expect(deleteCategory(db, groceries, { moveTo: restaurants })).toEqual({
      ok: true,
    });
    const builtinFor = (id: number) =>
      db
        .select()
        .from(rules)
        .all()
        .filter((r) => r.builtin && r.categoryId === id);

    // The deleted key is tombstoned, so the seeding pass skips its rules
    // instead of throwing on the missing leaf, and nothing re-creates them.
    expect(() => ensureBuiltinRules(db)).not.toThrow();
    expect(findCategoryId(db, "Groceries")).toBeUndefined();
    expect(builtinFor(groceries)).toHaveLength(0);
    expect(
      db
        .select()
        .from(rules)
        .all()
        .filter((r) => r.builtin && r.pattern === "kroger"),
    ).toHaveLength(0);
    expect(builtinFor(restaurants).length).toBeGreaterThan(0);

    // A key that is neither present nor tombstoned is still a hard error.
    BUILTIN_RULES.push({ pattern: "zzz", category: "nope/nope" });
    try {
      expect(() => ensureBuiltinRules(db)).toThrow("nope/nope");
    } finally {
      BUILTIN_RULES.pop();
    }

    // The maintenance rerun and an import both seed builtin rules on the way in.
    expect(() => rerunDetection(db)).not.toThrow();
    const acct = mustFind(db.select().from(accounts).all(), () => true);
    const res = commitImport(db, {
      accountId: acct.id,
      filename: "k.csv",
      text: "kroger-file",
      rows: [
        {
          date: "2026-06-10",
          amountCents: -1234,
          rawDescription: "KROGER 22",
          merchant: "KROGER 22",
        },
        {
          date: "2026-06-11",
          amountCents: -500,
          rawDescription: "CHIPOTLE",
          merchant: "CHIPOTLE",
        },
      ],
    });
    expect(res).toMatchObject({ newCount: 2, dupCount: 0 });
    const imported = db
      .select()
      .from(transactions)
      .all()
      .filter((t) => t.importId === res.importId);
    expect(imported).toHaveLength(2);
    // Kroger has no home any more; Chipotle still lands in Restaurants.
    expect(
      mustFind(imported, (t) => t.merchant.startsWith("Kroger")).categoryId,
    ).toBeNull();
    expect(
      mustFind(imported, (t) => t.merchant.startsWith("Chipotle")).categoryId,
    ).toBe(restaurants);
  });

  it("refuses a leaf that backs a live goal, and can delete an archived leaf", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const savings = findCategoryId(db, "Savings & investing") as number;
    const groceries = findCategoryId(db, "Groceries") as number;
    db.insert(goals)
      .values({ name: "Trip", targetCents: 1_000, categoryId: savings })
      .run();
    expect(deleteCategory(db, savings, { moveTo: groceries })).toEqual({
      ok: false,
      error: "Archive the goal instead.",
    });
    expect(archiveCategory(db, groceries)).toEqual({ ok: true });
    expect(deleteCategory(db, groceries)).toEqual({ ok: true });
    expect(findCategoryId(db, "Groceries")).toBeUndefined();
  });
});

describe("deleteParentCategory", () => {
  it("refuses while any leaf remains (even archived), succeeds when empty, tombstones seeded groups", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const health = mustFind(listCategoryTree(db), (p) => p.name === "Health");
    const medical = findCategoryId(db, "Medical & pharmacy") as number;
    expect(archiveCategory(db, medical)).toEqual({ ok: true });
    expect(deleteParentCategory(db, health.id)).toEqual({
      ok: false,
      error: "Delete or move its categories first.",
    });
    expect(deleteCategory(db, medical)).toEqual({ ok: true });
    expect(deleteParentCategory(db, health.id)).toEqual({ ok: true });
    expect(
      db
        .select()
        .from(categories)
        .all()
        .some((c) => c.id === health.id),
    ).toBe(false);
    expect(getSetting<string[]>(db, DELETED_SEED_KEYS, [])).toEqual([
      "health/medical-pharmacy",
      "health",
    ]);

    const pets = addParentCategory(db, "Pets");
    if (!pets.ok) throw new Error("add failed");
    expect(deleteParentCategory(db, pets.id)).toEqual({ ok: true });
    expect(getSetting<string[]>(db, DELETED_SEED_KEYS, [])).toHaveLength(2);

    const transfer = mustFind(
      listCategoryTree(db),
      (p) => p.name === "Transfer",
    );
    expect(deleteParentCategory(db, transfer.id)).toMatchObject({ ok: false });
    expect(deleteParentCategory(db, medical)).toMatchObject({ ok: false });
  });

  it("keeps the savings group, since new goals are created under it", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const savings = mustFind(
      listCategoryTree(db),
      (p) => p.name === "Savings & Investing",
    );
    const leaf = findCategoryId(db, "Savings & investing") as number;
    expect(deleteCategory(db, leaf)).toEqual({ ok: true });
    expect(deleteParentCategory(db, savings.id)).toEqual({
      ok: false,
      error: "Goals live here; it can't be deleted.",
    });
    expect(
      db
        .select()
        .from(categories)
        .all()
        .some((c) => c.id === savings.id),
    ).toBe(true);
  });
});
