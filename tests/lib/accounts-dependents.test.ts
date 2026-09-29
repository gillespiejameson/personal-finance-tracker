import { describe, expect, it } from "vitest";
import {
  getAccountDependents,
  listAccountDependents,
} from "@/lib/accounts/dependents";
import { openDb } from "@/lib/db/client";
import {
  accounts,
  balanceSnapshots,
  categories,
  rules,
  simplefinAccounts,
  transactions,
} from "@/lib/db/schema";

function seed() {
  const db = openDb(":memory:");
  const [a] = db
    .insert(accounts)
    .values({ name: "A", type: "checking" })
    .returning()
    .all();
  const [b] = db
    .insert(accounts)
    .values({ name: "B", type: "credit" })
    .returning()
    .all();
  const [cat] = db
    .insert(categories)
    .values({ name: "Groceries", kind: "expense", color: "#FF9500" })
    .returning()
    .all();
  return { db, a, b, cat };
}

describe("getAccountDependents", () => {
  it("counts rows that belong to the account only", () => {
    const { db, a, b, cat } = seed();
    db.insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-03-01",
          amountCents: -100,
          rawDescription: "X",
          merchant: "X",
          dedupeHash: "h1",
        },
        {
          accountId: b.id,
          date: "2026-03-01",
          amountCents: -100,
          rawDescription: "Y",
          merchant: "Y",
          dedupeHash: "h2",
        },
      ])
      .run();
    db.insert(balanceSnapshots)
      .values([
        { accountId: a.id, date: "2026-03-01", balanceCents: 500 },
        { accountId: a.id, date: "2026-03-02", balanceCents: 600 },
        { accountId: b.id, date: "2026-03-01", balanceCents: 700 },
      ])
      .run();
    db.insert(rules)
      .values([
        { pattern: "kroger", categoryId: cat.id, accountId: a.id },
        { pattern: "heb", categoryId: cat.id, accountId: null },
      ])
      .run();
    db.insert(simplefinAccounts)
      .values({ sfinId: "ACT-1", name: "Chk", accountId: b.id })
      .run();

    expect(getAccountDependents(db, a.id)).toEqual({
      transactions: 1,
      snapshots: 2,
      rules: 1,
      linked: false,
    });
    expect(getAccountDependents(db, b.id)).toEqual({
      transactions: 1,
      snapshots: 1,
      rules: 0,
      linked: true,
    });
  });

  it("is all zero for an account nothing references", () => {
    const { db, a } = seed();
    expect(getAccountDependents(db, a.id)).toEqual({
      transactions: 0,
      snapshots: 0,
      rules: 0,
      linked: false,
    });
  });
});

describe("listAccountDependents", () => {
  it("matches getAccountDependents for every account", () => {
    const { db, a, b, cat } = seed();
    const [c] = db
      .insert(accounts)
      .values({ name: "C", type: "savings" })
      .returning()
      .all();
    db.insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-03-01",
          amountCents: -100,
          rawDescription: "X",
          merchant: "X",
          dedupeHash: "h1",
        },
        {
          accountId: a.id,
          date: "2026-03-02",
          amountCents: -200,
          rawDescription: "X",
          merchant: "X",
          dedupeHash: "h2",
        },
        {
          accountId: b.id,
          date: "2026-03-01",
          amountCents: -100,
          rawDescription: "Y",
          merchant: "Y",
          dedupeHash: "h3",
        },
      ])
      .run();
    db.insert(balanceSnapshots)
      .values([
        { accountId: a.id, date: "2026-03-01", balanceCents: 500 },
        { accountId: b.id, date: "2026-03-01", balanceCents: 700 },
      ])
      .run();
    db.insert(rules)
      .values([
        { pattern: "kroger", categoryId: cat.id, accountId: a.id },
        { pattern: "heb", categoryId: cat.id, accountId: null },
      ])
      .run();
    db.insert(simplefinAccounts)
      .values([
        { sfinId: "ACT-1", name: "Chk", accountId: b.id },
        { sfinId: "ACT-2", name: "Unmapped", accountId: null },
      ])
      .run();

    const map = listAccountDependents(db);
    expect([...map.keys()].sort((x, y) => x - y)).toEqual([a.id, b.id, c.id]);
    for (const id of [a.id, b.id, c.id])
      expect(map.get(id)).toEqual(getAccountDependents(db, id));
  });

  it("gives an unreferenced account zero defaults", () => {
    const { db, a, b } = seed();
    expect(listAccountDependents(db).get(a.id)).toEqual({
      transactions: 0,
      snapshots: 0,
      rules: 0,
      linked: false,
    });
    expect(listAccountDependents(db).get(b.id)).toEqual({
      transactions: 0,
      snapshots: 0,
      rules: 0,
      linked: false,
    });
  });
});
