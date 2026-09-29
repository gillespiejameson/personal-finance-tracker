import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { todayIso } from "@/lib/dates";
import { openDb } from "@/lib/db/client";
import {
  accounts,
  imports,
  transactions,
  transferPairs,
} from "@/lib/db/schema";
import { commitImport, undoImport } from "@/lib/import/commit";
import type { ParsedRow } from "@/lib/import/types";
import { listSnapshots } from "@/lib/networth/store";
import { ensureBuiltinAliases } from "@/lib/normalize/aliases";
import { ensureBuiltinRules } from "@/lib/rules/builtin";
import { applyTransfers } from "@/lib/transfers/apply";
import { mustFind } from "../../helpers";

const r = (
  date: string,
  amountCents: number,
  rawDescription: string,
  balanceCents?: number | null,
): ParsedRow => ({
  date,
  amountCents,
  rawDescription,
  merchant: rawDescription,
  balanceCents,
});

describe("commitImport", () => {
  it("inserts, dedupes across overlapping files, flags fuzzy, and is undoable", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [acct] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();

    const first = commitImport(db, {
      accountId: acct.id,
      filename: "a.csv",
      text: "file-a",
      rows: [
        r("2026-03-01", -1000, "KROGER 1"),
        r("2026-03-02", -2000, "SHELL"),
      ],
    });
    expect(first).toMatchObject({ newCount: 2, dupCount: 0, flaggedCount: 0 });

    const second = commitImport(db, {
      accountId: acct.id,
      filename: "b.csv",
      text: "file-b",
      rows: [
        r("2026-03-02", -2000, "SHELL"),
        r("2026-03-03", -1000, "KROGER 1 CINCINNATI"),
        r("2026-03-10", -300, "COFFEE"),
      ],
    });
    expect(second).toMatchObject({ newCount: 2, dupCount: 1, flaggedCount: 1 });
    expect(
      db
        .select()
        .from(transactions)
        .all()
        .filter((t) => t.possibleDuplicate),
    ).toHaveLength(1);

    expect(() =>
      commitImport(db, {
        accountId: acct.id,
        filename: "b.csv",
        text: "file-b",
        rows: [],
      }),
    ).toThrow("already-imported");

    expect(undoImport(db, second.importId)).toBe(2);
    expect(db.select().from(transactions).all()).toHaveLength(2);
    const imps = db.select().from(imports).all();
    expect(imps).toHaveLength(1);
    // Stamped in local time, not the schema's UTC default, so an evening
    // import is not dated tomorrow.
    expect(imps[0].importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(imps[0].importedAt.slice(0, 10)).toBe(todayIso());
  });

  it("categorizes and refund-links the rows it just committed", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinAliases(db);
    ensureBuiltinRules(db);
    const [acct] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();

    const res = commitImport(db, {
      accountId: acct.id,
      filename: "heb.csv",
      text: "heb",
      rows: [
        r("2026-06-01", -6666, "H-E-B #042 SPRINGFIELD IL"),
        r("2026-06-06", 6666, "Refund H-E-B"),
      ],
    });
    expect(res).toMatchObject({ newCount: 2, categorized: 2 });

    const rows = db.select().from(transactions).all();
    const groceries = findCategoryId(db, "Groceries");
    const charge = mustFind(
      rows,
      (t) => t.amountCents === -6666,
      "the original charge",
    );
    const refund = mustFind(rows, (t) => t.amountCents === 6666, "the refund");
    expect(charge.categoryId).toBe(groceries);
    expect(refund.suspectedRefundOf).toBe(charge.id);
  });

  it("keeps identical same-day rows within one file, still dedupes across files", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [acct] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    const first = commitImport(db, {
      accountId: acct.id,
      filename: "a.csv",
      text: "file-a",
      rows: [
        r("2026-06-08", -300, "XYZ AIRPORT PARKING"),
        r("2026-06-08", -300, "XYZ AIRPORT PARKING"),
        r("2026-06-09", -1000, "KROGER"),
      ],
    });
    expect(first).toMatchObject({ newCount: 3, dupCount: 0 });
    const second = commitImport(db, {
      accountId: acct.id,
      filename: "b.csv",
      text: "file-b",
      rows: [
        r("2026-06-08", -300, "XYZ AIRPORT PARKING"),
        r("2026-06-08", -300, "XYZ AIRPORT PARKING"),
        r("2026-06-08", -300, "XYZ AIRPORT PARKING"),
      ],
    });
    expect(second).toMatchObject({ newCount: 1, dupCount: 2 }); // third same-day copy is new
    expect(db.select().from(transactions).all()).toHaveLength(4);
  });

  it("undo resets the surviving partner of a deleted transfer pair, but not rule-marked rows", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [chk] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    const [card] = db
      .insert(accounts)
      .values({ name: "Card", type: "credit" })
      .returning()
      .all();

    // Import 1: checking side of a card payment + an unrelated own-account transfer (rule-marked)
    const first = commitImport(db, {
      accountId: chk.id,
      filename: "chk.csv",
      text: "chk",
      rows: [
        r("2026-03-05", -50000, "ONLINE PMT TO CARD"),
        r("2026-03-06", -1000, "ONLINE TRANSFER TO SAV ...8800"),
      ],
    });
    // Import 2: card side of the payment → pairs with the checking row
    const second = commitImport(db, {
      accountId: card.id,
      filename: "card.csv",
      text: "card",
      rows: [r("2026-03-05", 50000, "Payment Thank You")],
    });
    expect(db.select().from(transferPairs).all()).toHaveLength(1);
    const before = db.select().from(transactions).all();
    expect(before.filter((t) => t.isTransfer)).toHaveLength(3);

    expect(undoImport(db, second.importId)).toBe(1);
    const after = db.select().from(transactions).all();
    expect(db.select().from(transferPairs).all()).toHaveLength(0);
    const autopay = mustFind(
      after,
      (t) => t.rawDescription === "ONLINE PMT TO CARD",
      "the card payment",
    );
    const ownTransfer = mustFind(
      after,
      (t) => t.rawDescription === "ONLINE TRANSFER TO SAV ...8800",
      "the rule-marked transfer",
    );
    expect(autopay).toMatchObject({
      isTransfer: false,
      categoryId: null,
      reviewed: false,
    });
    // Rule-marked (no pair), so it's left unreviewed for a future rerun to reassess.
    expect(ownTransfer).toMatchObject({ isTransfer: true, reviewed: false });
    expect(first.newCount).toBe(2);
  });

  it("pairs a transfer whose first side was rule-marked by an earlier import", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [chk] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    const [sav] = db
      .insert(accounts)
      .values({ name: "Sav", type: "savings" })
      .returning()
      .all();
    commitImport(db, {
      accountId: chk.id,
      filename: "a.csv",
      text: "a",
      rows: [r("2026-03-06", -40000, "ONLINE TRANSFER TO ALLY SAVINGS")],
    });
    expect(db.select().from(transferPairs).all()).toHaveLength(0);
    const second = commitImport(db, {
      accountId: sav.id,
      filename: "b.csv",
      text: "b",
      rows: [r("2026-03-06", 40000, "TRANSFER FROM CHASE CHECKING")],
    });
    expect(db.select().from(transferPairs).all()).toHaveLength(1);
    expect(second.newCount).toBe(1);
    expect(
      db
        .select()
        .from(transactions)
        .all()
        .every((t) => t.isTransfer),
    ).toBe(true);
    // idempotent
    expect(applyTransfers(db)).toEqual({ paired: 0, ruleMarked: 0 });
  });

  it("records balance snapshots from rows that carry a balance", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [acct] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();

    const first = commitImport(db, {
      accountId: acct.id,
      filename: "a.csv",
      text: "file-a",
      rows: [
        r("2026-09-01", 2000, "PAYCHECK", 91500),
        r("2026-09-03", -500, "SHELL", 91000),
        r("2026-09-03", -1000, "KROGER", 90000),
      ],
    });
    expect(first).toMatchObject({ newCount: 3 });
    expect(listSnapshots(db)).toEqual([
      { accountId: acct.id, date: "2026-09-01", balanceCents: 91500 },
      { accountId: acct.id, date: "2026-09-03", balanceCents: 90000 },
    ]);

    // Re-importing a fresher download with the same dates (all duplicate
    // transactions, but a later end-of-day balance) refreshes the snapshot.
    const second = commitImport(db, {
      accountId: acct.id,
      filename: "b.csv",
      text: "file-b",
      rows: [
        r("2026-09-01", 2000, "PAYCHECK", 91500),
        r("2026-09-03", -500, "SHELL", 91000),
        r("2026-09-03", -1000, "KROGER", 90000),
        r("2026-09-04", -200, "COFFEE", 89800),
      ],
    });
    expect(second).toMatchObject({ newCount: 1, dupCount: 3 });
    expect(listSnapshots(db)).toEqual([
      { accountId: acct.id, date: "2026-09-01", balanceCents: 91500 },
      { accountId: acct.id, date: "2026-09-03", balanceCents: 90000 },
      { accountId: acct.id, date: "2026-09-04", balanceCents: 89800 },
    ]);

    // Snapshots are facts about the account, not the import, so undo leaves them.
    expect(undoImport(db, second.importId)).toBe(1);
    expect(listSnapshots(db)).toEqual([
      { accountId: acct.id, date: "2026-09-01", balanceCents: 91500 },
      { accountId: acct.id, date: "2026-09-03", balanceCents: 90000 },
      { accountId: acct.id, date: "2026-09-04", balanceCents: 89800 },
    ]);
  });
});
