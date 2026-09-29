import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { addDays } from "@/lib/dates";
import { openDb } from "@/lib/db/client";
import {
  accounts,
  recurring,
  rules,
  transactions,
  transferPairs,
} from "@/lib/db/schema";
import {
  ensurePhase2,
  ensurePhase3,
  ensurePhase7,
  ensurePhase9,
  rerunDetection,
} from "@/lib/maintenance/rerun";
import { ensureBuiltinAliases } from "@/lib/normalize/aliases";
import { mustFind } from "../helpers";

describe("rerunDetection", () => {
  it("un-hides Zelle payments, keeps own-account transfers and pairs, categorizes, links refunds", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const transfer = findCategoryId(db, "Transfer") as number;
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
    // Rule-marked rows are already in Phase 2 shape here (reviewed: false) —
    // this test calls rerunDetection directly, not through the ensurePhase2
    // one-time upgrade, so it models a database already migrated to Phase 2.
    db.insert(transactions)
      .values([
        {
          accountId: chk.id,
          date: "2026-06-05",
          amountCents: -32500,
          rawDescription: "Zelle payment to Pat house JPM12abcdefg",
          merchant: "Zelle Payment TO Pat House Jpm12abcdefg",
          dedupeHash: "1",
          isTransfer: true,
          categoryId: transfer,
          reviewed: false,
        },
        {
          accountId: chk.id,
          date: "2026-06-06",
          amountCents: 120000,
          rawDescription: "Online Transfer from CHK ...4321 transaction#: 1",
          merchant: "Online Transfer From Chk",
          dedupeHash: "2",
          isTransfer: true,
          categoryId: transfer,
          reviewed: false,
        },
        {
          accountId: chk.id,
          date: "2026-06-07",
          amountCents: -40000,
          rawDescription: "ONLINE TRANSFER TO SAV ...8800",
          merchant: "Online Transfer TO Sav",
          dedupeHash: "3",
          isTransfer: true,
          categoryId: transfer,
          reviewed: true,
        },
        {
          accountId: sav.id,
          date: "2026-06-07",
          amountCents: 40000,
          rawDescription: "TRANSFER FROM CHECKING",
          merchant: "Transfer From Checking",
          dedupeHash: "4",
          isTransfer: true,
          categoryId: transfer,
          reviewed: true,
        },
        {
          accountId: chk.id,
          date: "2026-06-08",
          amountCents: -6666,
          rawDescription: "H-E-B #042 SPRINGFIELD IL",
          merchant: "H-e-b #042 Springfield IL",
          dedupeHash: "5",
        },
        {
          accountId: chk.id,
          date: "2026-06-09",
          amountCents: -350000,
          rawDescription: "APPLECARD GSBANK PAYMENT 1234567 WEB ID: 9999999999",
          merchant: "Applecard Gsbank Payment 1234567 Web Id:",
          dedupeHash: "6",
          isTransfer: true,
          categoryId: transfer,
          reviewed: false,
        },
        {
          accountId: chk.id,
          date: "2026-06-10",
          amountCents: -64321,
          rawDescription: "SP BANJO BARN LLC MAPLETON IL",
          merchant: "Banjo Barn Llc Mapleton IL",
          dedupeHash: "7",
        },
        {
          accountId: chk.id,
          date: "2026-06-20",
          amountCents: 64321,
          rawDescription: "Refund SP BANJO BARN LLC MAPLETON IL",
          merchant: "Refund SP Banjo Barn Llc Mapleton IL",
          dedupeHash: "8",
        },
      ])
      .run();
    // the pair 3<->4 already exists from Phase 1
    db.insert(transferPairs)
      .values({ fromTxnId: 3, toTxnId: 4, confidence: 100 })
      .run();

    const report = rerunDetection(db);
    const rows = db.select().from(transactions).all();
    const by = (h: string) =>
      mustFind(rows, (r) => r.dedupeHash === h, `row ${h}`);
    expect(by("1")).toMatchObject({
      isTransfer: false,
      merchant: "Pat House",
      reviewed: false,
    });
    expect(by("2")).toMatchObject({ isTransfer: true, categoryId: transfer });
    expect(by("3").isTransfer).toBe(true);
    expect(by("4").isTransfer).toBe(true);
    expect(by("5")).toMatchObject({
      merchant: "H-E-B",
      categoryId: findCategoryId(db, "Groceries"),
    });
    expect(by("6")).toMatchObject({
      isTransfer: false,
      merchant: "Apple Card Payment",
      categoryId: findCategoryId(db, "Card payments"),
    });
    expect(by("8").suspectedRefundOf).toBe(by("7").id);
    expect(db.select().from(transferPairs).all()).toHaveLength(1);
    expect(report.transfersReset).toBe(3); // rows 1, 2, 6 (3 and 4 are paired)
    expect(report.ruleMarked).toBe(1); // row 2 re-marked
    expect(report.categorized).toBeGreaterThanOrEqual(2);

    const again = rerunDetection(db);
    expect(again.merchantsUpdated).toBe(0);
    expect(again.transfersReset).toBe(again.ruleMarked);
    expect(again.categorized).toBe(0);
    expect(again.refundsLinked).toBe(0);
  });

  it("ensurePhase2 runs once", () => {
    const db = openDb(":memory:");
    expect(ensurePhase2(db)).not.toBeNull();
    expect(ensurePhase2(db)).toBeNull();
  });

  it("ensurePhase3 seeds recurring detection once for an existing database", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    let d = "2026-04-12";
    const rows: {
      accountId: number;
      date: string;
      amountCents: number;
      rawDescription: string;
      merchant: string;
      dedupeHash: string;
    }[] = [];
    for (let i = 0; i < 3; i++) {
      rows.push({
        accountId: a.id,
        date: d,
        amountCents: -31257,
        rawDescription: "Geico",
        merchant: "Geico",
        dedupeHash: `p3-${i}`,
      });
      d = addDays(d, 28);
    }
    db.insert(transactions).values(rows).run();

    expect(ensurePhase3(db)).toBe(1);
    expect(ensurePhase3(db)).toBeNull();
  });

  it("ensurePhase7 re-applies rules to unreviewed rows once, correcting a Paycheck outflow", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const paycheck = findCategoryId(db, "Paycheck") as number;
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    const row = (
      dedupeHash: string,
      amountCents: number,
      reviewed: boolean,
      rawDescription = "Globex Corp -PAYROLL",
    ) => ({
      accountId: a.id,
      date: "2026-06-05",
      amountCents,
      rawDescription,
      merchant: "Globex Corp Payroll",
      dedupeHash,
      categoryId: paycheck,
      reviewed,
    });
    db.insert(transactions)
      .values([
        row("deposit", 248312, false),
        row("debit", -98765, false),
        row("debit-reviewed", -98765, true),
        // A weaker rule than payroll still fits once the sign check rejects it.
        row("debit-fee", -98765, false, "PAYROLL OVERDRAFT FEE"),
      ])
      .run();

    // Three unreviewed rows are recomputed: the deposit (still Paycheck), the
    // fee (now Interest & fees) and the bare debit (cleared).
    expect(ensurePhase7(db)).toBe(3);
    const rows = db.select().from(transactions).all();
    const by = (h: string) =>
      mustFind(rows, (r) => r.dedupeHash === h, `row ${h}`);
    expect(by("deposit").categoryId).toBe(paycheck);
    expect(by("debit")).toMatchObject({ categoryId: null, reviewed: false });
    expect(by("debit-reviewed")).toMatchObject({
      categoryId: paycheck,
      reviewed: true,
    });
    expect(by("debit-fee").categoryId).toBe(
      findCategoryId(db, "Interest & fees"),
    );
    expect(ensurePhase7(db)).toBeNull();
  });

  it("respects a user-confirmed transfer mark, but un-marks the same row if it was only rule-marked", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const transfer = findCategoryId(db, "Transfer") as number;
    const [chk] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    const row = (dedupeHash: string, reviewed: boolean) => ({
      accountId: chk.id,
      date: "2026-06-05",
      amountCents: -5000,
      rawDescription: "Zelle payment to Sam",
      merchant: "Sam",
      dedupeHash,
      isTransfer: true,
      categoryId: transfer,
      reviewed,
    });
    db.insert(transactions)
      .values([row("user-marked", true), row("rule-marked", false)])
      .run();

    rerunDetection(db);
    const rows = db.select().from(transactions).all();
    // "Zelle payment to Sam" isn't own-account wording, so applyTransfers
    // would never mark this row itself — whatever survives is purely a
    // function of resetRuleMarkedTransfers respecting the user's mark.
    expect(mustFind(rows, (r) => r.dedupeHash === "user-marked")).toMatchObject(
      { isTransfer: true, reviewed: true },
    );
    expect(mustFind(rows, (r) => r.dedupeHash === "rule-marked")).toMatchObject(
      { isTransfer: false, categoryId: null, reviewed: false },
    );
  });
});

describe("ensurePhase9", () => {
  it("re-resolves suffixed merchants, applies rules to uncategorized rows, refreshes bills, runs once", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinAliases(db);
    const groceries = findCategoryId(db, "Groceries") as number;
    const other = findCategoryId(db, "Restaurants") as number;
    const [chk] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    // What the old pipeline produced for the synced row: the card's last four
    // and the cardholder's name survived into the merchant string.
    const stale = "Vercel Inc Ca 4242 First M Last";
    db.insert(transactions)
      .values([
        {
          accountId: chk.id,
          date: "2026-09-03",
          amountCents: -2132,
          rawDescription: "VERCEL INC. VERCEL.COM CA 4242 - FIRST M LAST",
          merchant: stale,
          dedupeHash: "a",
          externalId: "t1",
        },
        {
          accountId: chk.id,
          date: "2026-08-03",
          amountCents: -2132,
          rawDescription: "VERCEL INC. VERCEL.COM CA",
          merchant: "Vercel Inc",
          dedupeHash: "b",
        },
        {
          accountId: chk.id,
          date: "2026-09-04",
          amountCents: -5000,
          rawDescription: "KROGER #1234 SPRINGFIELD IL 5555 - FIRST LAST",
          merchant: "Kroger 5555 First Last",
          dedupeHash: "c",
          externalId: "t2",
        },
        {
          accountId: chk.id,
          date: "2026-09-05",
          amountCents: -6000,
          rawDescription: "KROGER #1234 SPRINGFIELD IL 5555 - FIRST LAST",
          merchant: "Kroger 5555 First Last",
          dedupeHash: "d",
          externalId: "t3",
          categoryId: other,
          reviewed: true,
        },
      ])
      .run();
    db.insert(rules)
      .values({ pattern: "kroger", categoryId: groceries, field: "merchant" })
      .run();

    expect(ensurePhase9(db)).toBe(3);
    const rows = db
      .select()
      .from(transactions)
      .orderBy(transactions.dedupeHash)
      .all();
    expect(rows[0].merchant).toBe(rows[1].merchant); // synced row equals its CSV twin
    expect(rows[0].merchant).toBe("Vercel Inc");
    expect(rows[2].merchant).toBe("Kroger");
    expect(rows[2].categoryId).toBe(groceries); // uncategorized row picked up the rule
    expect(rows[3].merchant).toBe("Kroger");
    expect(rows[3].categoryId).toBe(other); // reviewed row untouched
    // refreshRecurring ran: with both Vercel rows now on the same merchant,
    // the two identical -2132 charges a month apart are the "likely" bill.
    const bills = db.select().from(recurring).all();
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({
      merchant: "Vercel Inc",
      confidence: "likely",
    });
    expect(ensurePhase9(db)).toBeNull(); // runs once
  });
});
