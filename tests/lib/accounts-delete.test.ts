import { describe, expect, it } from "vitest";
import { deleteAccountIfEmpty } from "@/lib/accounts/delete";
import { openDb } from "@/lib/db/client";
import {
  accounts,
  balanceSnapshots,
  categories,
  imports,
  rules,
  simplefinAccounts,
  transactions,
} from "@/lib/db/schema";

function account(db: ReturnType<typeof openDb>, name: string) {
  const [row] = db
    .insert(accounts)
    .values({ name, type: "checking" })
    .returning()
    .all();
  return row;
}

describe("deleteAccountIfEmpty", () => {
  it("deletes an account whose only leftover is an empty import row", () => {
    const db = openDb(":memory:");
    const acct = account(db, "Chk");
    db.insert(imports)
      .values({
        accountId: acct.id,
        filename: "all-dupes.csv",
        fileHash: "h1",
        rowCount: 3,
        newCount: 0,
        dupCount: 3,
      })
      .run();

    expect(deleteAccountIfEmpty(db, acct.id)).toEqual({ ok: true });
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(db.select().from(imports).all()).toHaveLength(0);
  });

  it("refuses an account that still has transactions", () => {
    const db = openDb(":memory:");
    const acct = account(db, "Chk");
    db.insert(transactions)
      .values({
        accountId: acct.id,
        date: "2026-03-01",
        amountCents: -1000,
        rawDescription: "KROGER",
        merchant: "Kroger",
        dedupeHash: "d1",
      })
      .run();

    const res = deleteAccountIfEmpty(db, acct.id);
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toMatch(/1 transactions and can't be deleted/);
    expect(db.select().from(accounts).all()).toHaveLength(1);
  });

  it("leaves other accounts and their imports alone", () => {
    const db = openDb(":memory:");
    const gone = account(db, "Old");
    const kept = account(db, "Keep");
    db.insert(imports)
      .values([
        {
          accountId: gone.id,
          filename: "a.csv",
          fileHash: "ha",
          rowCount: 1,
          newCount: 0,
          dupCount: 1,
        },
        {
          accountId: kept.id,
          filename: "b.csv",
          fileHash: "hb",
          rowCount: 1,
          newCount: 0,
          dupCount: 1,
        },
      ])
      .run();

    expect(deleteAccountIfEmpty(db, gone.id)).toEqual({ ok: true });
    expect(
      db
        .select()
        .from(imports)
        .all()
        .map((i) => i.accountId),
    ).toEqual([kept.id]);
  });

  it("removes snapshots, scoped rules and empty imports, and unmaps the SimpleFIN link", () => {
    const db = openDb(":memory:");
    const gone = account(db, "Spare");
    const kept = account(db, "Keep");
    const [cat] = db
      .insert(categories)
      .values({ name: "Groceries", kind: "expense", color: "#FF9500" })
      .returning()
      .all();
    db.insert(balanceSnapshots)
      .values([
        { accountId: gone.id, date: "2026-09-08", balanceCents: 187412 },
        { accountId: kept.id, date: "2026-09-08", balanceCents: 100 },
      ])
      .run();
    db.insert(rules)
      .values([
        { pattern: "kroger", categoryId: cat.id, accountId: gone.id },
        { pattern: "heb", categoryId: cat.id, accountId: kept.id },
        { pattern: "aldi", categoryId: cat.id, accountId: null },
      ])
      .run();
    db.insert(imports)
      .values({
        accountId: gone.id,
        filename: "empty.csv",
        fileHash: "h9",
        rowCount: 0,
        newCount: 0,
        dupCount: 0,
      })
      .run();
    db.insert(simplefinAccounts)
      .values({ sfinId: "ACT-9", name: "Card", accountId: gone.id })
      .run();

    expect(deleteAccountIfEmpty(db, gone.id)).toEqual({ ok: true });
    expect(
      db
        .select()
        .from(accounts)
        .all()
        .map((a) => a.id),
    ).toEqual([kept.id]);
    expect(db.select().from(balanceSnapshots).all()).toEqual([
      expect.objectContaining({ accountId: kept.id }),
    ]);
    expect(
      db
        .select()
        .from(rules)
        .all()
        .map((r) => r.pattern)
        .sort(),
    ).toEqual(["aldi", "heb"]);
    expect(db.select().from(imports).all()).toHaveLength(0);
    expect(db.select().from(simplefinAccounts).get()).toMatchObject({
      sfinId: "ACT-9",
      accountId: null,
    });
  });
});
