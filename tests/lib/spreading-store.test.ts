import { isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";
import {
  archivePlanned,
  createPlanned,
  listPlanned,
  listPlannedCategoryOptions,
  updatePlanned,
} from "@/lib/spreading/store";

function seed() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  return db;
}

describe("spreading store", () => {
  it("creates, lists, updates and archives a planned expense", () => {
    const db = seed();
    const groceries = findCategoryId(db, "Groceries");
    expect(groceries).toBeDefined();
    const created = createPlanned(db, {
      name: "Car registration",
      amountCents: 20000,
      dueDate: "2026-12-01",
      every: "year",
      categoryId: groceries ?? null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected ok");

    const listed = listPlanned(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: created.id,
      name: "Car registration",
      amountCents: 20000,
      dueDate: "2026-12-01",
      every: "year",
      categoryId: groceries,
      archived: false,
    });
    expect(typeof listed[0].createdAt).toBe("string");
    expect(listed[0].createdAt.length).toBeGreaterThan(0);

    const updated = updatePlanned(db, created.id, { amountCents: 25000 });
    expect(updated).toEqual({ ok: true });
    expect(listPlanned(db)[0].amountCents).toBe(25000);

    const archived = archivePlanned(db, created.id);
    expect(archived).toEqual({ ok: true });
    expect(listPlanned(db)).toHaveLength(0);
    expect(listPlanned(db, { includeArchived: true })).toHaveLength(1);
  });

  it("rejects a non-leaf (parent) category on create and update", () => {
    const db = seed();
    const parent = db
      .select({ id: categories.id })
      .from(categories)
      .where(isNull(categories.parentId))
      .get();
    expect(parent).toBeDefined();
    const parentId = (parent as { id: number }).id;
    const created = createPlanned(db, {
      name: "Bad",
      amountCents: 1000,
      dueDate: "2026-12-01",
      every: "once",
      categoryId: parentId,
    });
    expect(created).toEqual({
      ok: false,
      error: "Category must be a leaf category.",
    });

    const leaf = findCategoryId(db, "Groceries");
    expect(leaf).toBeDefined();
    const ok = createPlanned(db, {
      name: "Good",
      amountCents: 1000,
      dueDate: "2026-12-01",
      every: "once",
      categoryId: leaf as number,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("expected ok");
    const updated = updatePlanned(db, ok.id, { categoryId: parentId });
    expect(updated).toEqual({
      ok: false,
      error: "Category must be a leaf category.",
    });
  });

  it("excludes income leaves from planned-expense category options", () => {
    const db = seed();
    const options = listPlannedCategoryOptions(db);
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((o) => o.name === "Groceries")).toBe(true);
    expect(options.some((o) => o.name === "Paycheck")).toBe(false);
  });

  it("errors on updating/archiving an unknown id", () => {
    const db = seed();
    expect(updatePlanned(db, 999, { amountCents: 100 })).toEqual({
      ok: false,
      error: "Planned expense not found.",
    });
    expect(archivePlanned(db, 999)).toEqual({
      ok: false,
      error: "Planned expense not found.",
    });
  });
});
