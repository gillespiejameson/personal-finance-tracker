import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CATEGORIES_SEED_VERSION_KEY,
  DEFAULT_CATEGORIES,
} from "@/lib/categories/defaults";
import {
  DELETED_SEED_KEYS,
  ensureDefaultCategories,
  ensureLeaf,
  findCategoryId,
} from "@/lib/categories/ensure";
import {
  deleteCategory,
  deleteParentCategory,
  renameCategory,
} from "@/lib/categories/manage";
import { openDb } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { mustFind } from "../helpers";

/** Pretend DEFAULT_CATEGORIES changed, so the next sweep actually runs. */
function bumpSeedVersion(db: ReturnType<typeof openDb>) {
  setSetting(db, CATEGORIES_SEED_VERSION_KEY, 0);
}

describe("ensureDefaultCategories", () => {
  it("seeds 13 parents and 27 leaves, idempotently", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureDefaultCategories(db);
    const all = db.select().from(categories).all();
    expect(all.filter((c) => c.parentId === null)).toHaveLength(13);
    expect(all.filter((c) => c.parentId !== null)).toHaveLength(27);
    expect(findCategoryId(db, "Groceries")).toBeTypeOf("number");
    expect(findCategoryId(db, "Nope")).toBeUndefined();
  });

  it("gives every seeded category a stable key", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const all = db.select().from(categories).all();
    expect(all.every((c) => c.seedKey !== null)).toBe(true);
    expect(new Set(all.map((c) => c.seedKey)).size).toBe(all.length);
    expect(
      mustFind(all, (c) => c.name === "Card payments", "Card payments").seedKey,
    ).toBe("debt/card-payments");
    const parentKeys = DEFAULT_CATEGORIES.map((p) => p.key);
    expect(
      all.filter((c) => c.parentId === null).map((c) => c.seedKey),
    ).toEqual(parentKeys);
  });

  it("skips the sweep while the recorded seed version is current", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    db.delete(categories).where(eq(categories.name, "Card payments")).run();
    ensureDefaultCategories(db);
    expect(findCategoryId(db, "Card payments")).toBeUndefined();
  });

  it("adds newly introduced leaves to an existing database", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const debt = mustFind(
      db.select().from(categories).all(),
      (c) => c.name === "Debt" && c.parentId === null,
      "Debt parent",
    );
    db.delete(categories).where(eq(categories.name, "Card payments")).run();
    bumpSeedVersion(db);
    ensureDefaultCategories(db);
    const leaf = mustFind(
      db.select().from(categories).all(),
      (c) => c.name === "Card payments",
      "Card payments leaf",
    );
    expect(leaf.parentId).toBe(debt.id);
    expect(leaf.isFixed).toBe(true);
    expect(leaf.seedKey).toBe("debt/card-payments");
    expect(ensureLeaf(db, "Debt", "Card payments")).toBe(leaf.id);
  });

  it("does not resurrect a default category the user renamed", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const debt = mustFind(
      db.select().from(categories).all(),
      (c) => c.name === "Debt" && c.parentId === null,
      "Debt parent",
    );
    const before = mustFind(
      db.select().from(categories).all(),
      (c) => c.name === "Card payments",
      "Card payments leaf",
    );
    expect(renameCategory(db, before.id, "Credit card bills")).toEqual({
      ok: true,
    });

    for (let i = 0; i < 2; i++) {
      bumpSeedVersion(db);
      ensureDefaultCategories(db);
    }

    const underDebt = db
      .select()
      .from(categories)
      .all()
      .filter(
        (c) => c.parentId === debt.id && c.seedKey === "debt/card-payments",
      );
    expect(underDebt).toHaveLength(1);
    expect(underDebt[0].id).toBe(before.id);
    expect(underDebt[0].name).toBe("Credit card bills");
    expect(findCategoryId(db, "Card payments")).toBeUndefined();
  });

  it("backfills keys on a database seeded before they existed", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    db.update(categories).set({ seedKey: null }).run();
    bumpSeedVersion(db);
    ensureDefaultCategories(db);
    const all = db.select().from(categories).all();
    expect(all.filter((c) => c.seedKey === null)).toHaveLength(0);
    expect(all.filter((c) => c.parentId !== null)).toHaveLength(27);
  });

  it("does not re-seed a deleted default leaf, even across seed version bumps", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const cardPayments = findCategoryId(db, "Card payments") as number;
    expect(deleteCategory(db, cardPayments)).toEqual({ ok: true });
    expect(getSetting<string[]>(db, DELETED_SEED_KEYS, [])).toEqual([
      "debt/card-payments",
    ]);

    for (let i = 0; i < 2; i++) {
      bumpSeedVersion(db);
      ensureDefaultCategories(db);
    }
    expect(findCategoryId(db, "Card payments")).toBeUndefined();
    expect(
      db
        .select()
        .from(categories)
        .all()
        .filter((c) => c.parentId !== null),
    ).toHaveLength(26);

    // A direct ensureLeaf with the tombstoned key stays out too, but the
    // same name under a different identity is a normal add.
    expect(
      ensureLeaf(db, "Debt", "Card payments", {
        seedKey: "debt/card-payments",
      }),
    ).toBeUndefined();
    expect(ensureLeaf(db, "Debt", "Card payments")).toBeTypeOf("number");
  });

  it("does not re-seed a deleted default group or its leaves", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const health = mustFind(
      db.select().from(categories).all(),
      (c) => c.name === "Health" && c.parentId === null,
      "Health parent",
    );
    const medical = findCategoryId(db, "Medical & pharmacy") as number;
    expect(deleteCategory(db, medical)).toEqual({ ok: true });
    expect(deleteParentCategory(db, health.id)).toEqual({ ok: true });

    bumpSeedVersion(db);
    ensureDefaultCategories(db);
    const all = db.select().from(categories).all();
    expect(all.some((c) => c.name === "Health" && c.parentId === null)).toBe(
      false,
    );
    expect(findCategoryId(db, "Medical & pharmacy")).toBeUndefined();
    expect(all.filter((c) => c.parentId === null)).toHaveLength(12);
  });

  it("skips tombstoned keys when seeding an empty database", () => {
    const db = openDb(":memory:");
    setSetting(db, DELETED_SEED_KEYS, ["food/groceries", "health"]);
    ensureDefaultCategories(db);
    const all = db.select().from(categories).all();
    expect(findCategoryId(db, "Groceries")).toBeUndefined();
    expect(findCategoryId(db, "Medical & pharmacy")).toBeUndefined();
    expect(all.filter((c) => c.parentId === null)).toHaveLength(12);
    expect(all.filter((c) => c.parentId !== null)).toHaveLength(25);
  });
});
