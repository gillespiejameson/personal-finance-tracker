import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ensureDefaultCategories } from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { accounts, categories, transactions } from "@/lib/db/schema";
import {
  archiveGoal,
  createGoal,
  listGoals,
  updateGoal,
} from "@/lib/goals/store";
import { bucketOf } from "@/lib/insights/aggregate";
import { loadLines } from "@/lib/insights/lines";

function seed() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  const [account] = db
    .insert(accounts)
    .values({ name: "Chk", type: "checking" })
    .returning()
    .all();
  return { db, account };
}

let dedupe = 0;
function insertTxn(
  db: ReturnType<typeof openDb>,
  accountId: number,
  categoryId: number | null,
  date: string,
  amountCents: number,
  merchant = "Transfer to savings",
) {
  db.insert(transactions)
    .values({
      accountId,
      date,
      amountCents,
      merchant,
      rawDescription: merchant,
      dedupeHash: `g${dedupe++}`,
      categoryId,
    })
    .run();
}

describe("createGoal", () => {
  it("creates a fixed leaf under Savings & Investing with no seed key", () => {
    const { db } = seed();
    const result = createGoal(db, {
      name: "Emergency Fund",
      targetCents: 500000,
      targetDate: "2026-12-31",
      startingCents: 10000,
      today: "2026-09-06",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const goalRow = db
      .select()
      .from(categories)
      .all()
      .find((c) => c.name === "Emergency Fund");
    expect(goalRow).toBeTruthy();
    expect(goalRow?.isFixed).toBe(true);
    expect(goalRow?.seedKey).toBeNull();
  });

  it("buckets a contribution to the goal leaf as savings", () => {
    const { db, account } = seed();
    const result = createGoal(db, {
      name: "New Car",
      targetCents: 1000000,
      targetDate: null,
      startingCents: 0,
      today: "2026-09-06",
    });
    if (!result.ok) throw new Error("expected ok");
    const goalRow = db
      .select()
      .from(categories)
      .where(eq(categories.name, "New Car"))
      .get();
    insertTxn(db, account.id, goalRow?.id ?? null, "2026-09-10", -20000);
    const [line] = loadLines(db);
    expect(bucketOf(line)).toBe("savings");
  });

  it("refuses an empty name", () => {
    const { db } = seed();
    const result = createGoal(db, {
      name: "   ",
      targetCents: 100000,
      targetDate: null,
      startingCents: 0,
      today: "2026-09-06",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a duplicate name", () => {
    const { db } = seed();
    createGoal(db, {
      name: "Vacation",
      targetCents: 100000,
      targetDate: null,
      startingCents: 0,
      today: "2026-09-06",
    });
    const dup = createGoal(db, {
      name: "Vacation",
      targetCents: 200000,
      targetDate: null,
      startingCents: 0,
      today: "2026-09-06",
    });
    expect(dup.ok).toBe(false);
  });
});

describe("listGoals", () => {
  it("counts only contributions on or after the start date", () => {
    const { db, account } = seed();
    const created = createGoal(db, {
      name: "Home Down Payment",
      targetCents: 2000000,
      targetDate: "2026-12-15",
      startingCents: 20000,
      today: "2026-09-06",
    });
    if (!created.ok) throw new Error("expected ok");
    const goalRow = db
      .select()
      .from(categories)
      .where(eq(categories.name, "Home Down Payment"))
      .get();
    // Before the start date: must not count.
    insertTxn(db, account.id, goalRow?.id ?? null, "2026-08-01", -50000);
    // On/after the start date: must count.
    insertTxn(db, account.id, goalRow?.id ?? null, "2026-09-06", -30000);
    insertTxn(db, account.id, goalRow?.id ?? null, "2026-09-20", -10000);
    const lines = loadLines(db);
    const [goal] = listGoals(db, lines, "2026-09-06");
    expect(goal.progressCents).toBe(20000 + 30000 + 10000);
  });
});

describe("updateGoal", () => {
  it("renames the leaf", () => {
    const { db } = seed();
    const created = createGoal(db, {
      name: "Old Name",
      targetCents: 100000,
      targetDate: null,
      startingCents: 0,
      today: "2026-09-06",
    });
    if (!created.ok) throw new Error("expected ok");
    const result = updateGoal(db, created.id, { name: "New Name" });
    expect(result.ok).toBe(true);
    const goalRow = db
      .select()
      .from(categories)
      .all()
      .find((c) => c.name === "New Name");
    expect(goalRow).toBeTruthy();
  });
});

describe("archiveGoal", () => {
  it("hides the goal from listGoals unless includeArchived", () => {
    const { db } = seed();
    const created = createGoal(db, {
      name: "Archived Fund",
      targetCents: 100000,
      targetDate: null,
      startingCents: 0,
      today: "2026-09-06",
    });
    if (!created.ok) throw new Error("expected ok");
    archiveGoal(db, created.id);
    const lines = loadLines(db);
    expect(listGoals(db, lines, "2026-09-06")).toHaveLength(0);
    expect(
      listGoals(db, lines, "2026-09-06", { includeArchived: true }),
    ).toHaveLength(1);
  });
});
