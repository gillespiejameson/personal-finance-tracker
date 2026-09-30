import { describe, expect, it } from "vitest";
import { ensureDefaultCategories } from "@/lib/categories/ensure";
import { daysBetween } from "@/lib/dates";
import { openDb } from "@/lib/db/client";
import { accounts, transactions, transferPairs } from "@/lib/db/schema";
import { applyTransfers } from "@/lib/transfers/apply";
import {
  isOwnTransfer,
  pairTransfers,
  type TxnLite,
} from "@/lib/transfers/detect";
import { mustFind } from "../helpers";

const t = (
  id: number,
  accountId: number,
  date: string,
  amountCents: number,
  desc = "x",
) => ({
  id,
  accountId,
  date,
  amountCents,
  rawDescription: desc,
  isTransfer: false,
});

describe("pairTransfers", () => {
  it("pairs equal/opposite across accounts within 3 days", () => {
    const pairs = pairTransfers([
      t(1, 1, "2026-03-05", -20000),
      t(2, 2, "2026-03-06", 20000),
    ]);
    expect(pairs).toEqual([{ fromId: 1, toId: 2, confidence: 90 }]);
  });
  it("does not pair within the same account or beyond 3 days", () => {
    expect(
      pairTransfers([
        t(1, 1, "2026-03-05", -20000),
        t(2, 1, "2026-03-05", 20000),
      ]),
    ).toHaveLength(0);
    expect(
      pairTransfers([
        t(1, 1, "2026-03-05", -20000),
        t(2, 2, "2026-03-09", 20000),
      ]),
    ).toHaveLength(0);
  });
  it("uses each transaction once, nearest date first", () => {
    const pairs = pairTransfers([
      t(1, 1, "2026-03-05", -5000),
      t(2, 2, "2026-03-07", 5000),
      t(3, 2, "2026-03-05", 5000),
      t(4, 1, "2026-03-20", -5000),
    ]);
    expect(pairs).toEqual([{ fromId: 1, toId: 3, confidence: 100 }]);
  });
  it("finds the assignment that matches both when greedy-by-outflow would strand one", () => {
    const pairs = pairTransfers([
      t(1, 1, "2026-03-02", -1000),
      t(2, 1, "2026-03-03", -1000),
      t(3, 2, "2026-03-01", 1000),
      t(4, 2, "2026-02-27", 1000),
    ]);
    expect(pairs.map((p) => [p.fromId, p.toId]).sort()).toEqual([
      [1, 4],
      [2, 3],
    ]);
  });

  it("prefers the nearer-date assignment among maximum matchings", () => {
    const pairs = pairTransfers([
      t(1, 1, "2026-03-04", -1000),
      t(3, 1, "2026-03-05", -1000),
      t(11, 2, "2026-03-04", 1000),
      t(12, 2, "2026-03-07", 1000),
    ]);
    expect(pairs.sort((a, b) => a.fromId - b.fromId)).toEqual([
      { fromId: 1, toId: 11, confidence: 100 },
      { fromId: 3, toId: 12, confidence: 90 },
    ]);
  });

  it("matches brute force on random small buckets (max count, then min total distance)", () => {
    // deterministic PRNG
    let s = 12345;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const day = (n: number) => `2026-03-${String(1 + n).padStart(2, "0")}`;
    for (let trial = 0; trial < 200; trial++) {
      const nOut = 1 + Math.floor(rnd() * 4);
      const nIn = 1 + Math.floor(rnd() * 4);
      const txns: TxnLite[] = [];
      for (let i = 0; i < nOut; i++)
        txns.push(
          t(
            i + 1,
            1 + Math.floor(rnd() * 2),
            day(Math.floor(rnd() * 10)),
            -1000,
          ),
        );
      for (let j = 0; j < nIn; j++)
        txns.push(
          t(
            100 + j,
            1 + Math.floor(rnd() * 2),
            day(Math.floor(rnd() * 10)),
            1000,
          ),
        );
      const pairs = pairTransfers(txns);
      const byId = new Map(txns.map((x) => [x.id, x]));
      const dateOf = (id: number) => {
        const x = byId.get(id);
        if (!x) throw new Error(`missing txn ${id}`);
        return x.date;
      };
      const dist = (p: { fromId: number; toId: number }) =>
        Math.abs(daysBetween(dateOf(p.fromId), dateOf(p.toId)));
      // brute force: enumerate injective partial assignments outs→ins
      const outs = txns.filter((x) => x.amountCents < 0);
      const ins = txns.filter((x) => x.amountCents > 0);
      let bestCount = 0;
      let bestCost = Number.POSITIVE_INFINITY;
      const rec = (
        i: number,
        used: Set<number>,
        count: number,
        cost: number,
      ) => {
        if (i === outs.length) {
          if (count > bestCount || (count === bestCount && cost < bestCost)) {
            bestCount = count;
            bestCost = cost;
          }
          return;
        }
        rec(i + 1, used, count, cost);
        for (const inn of ins) {
          if (used.has(inn.id) || inn.accountId === outs[i].accountId) continue;
          const d = Math.abs(daysBetween(outs[i].date, inn.date));
          if (d > 3) continue;
          used.add(inn.id);
          rec(i + 1, used, count + 1, cost + d);
          used.delete(inn.id);
        }
      };
      rec(0, new Set(), 0, 0);
      expect(pairs.length).toBe(bestCount);
      expect(pairs.reduce((a, p) => a + dist(p), 0)).toBe(
        bestCost === Number.POSITIVE_INFINITY ? 0 : bestCost,
      );
      // each side used at most once
      expect(new Set(pairs.map((p) => p.fromId)).size).toBe(pairs.length);
      expect(new Set(pairs.map((p) => p.toId)).size).toBe(pairs.length);
    }
  });
});

describe("isOwnTransfer", () => {
  it.each([
    ["Online Transfer from CHK ...4321 transaction#: 12345678901", "checking"],
    [
      "Online Transfer 45645645645 to FNB Checking #####9999 transaction #: 45645645645",
      "checking",
    ],
    ["ONLINE TRANSFER TO SAV ...8800", "checking"],
    [
      "fnb              ACH XFER                   WEB ID: 123456789",
      "checking",
    ],
    ["TRANSFER FROM CHECKING", "savings"],
    ["Payment Thank You-Mobile", "credit"],
    ["AUTOMATIC PAYMENT - THANK YOU", "credit"],
  ])("%s on %s is an own-account transfer", (d, t) =>
    expect(isOwnTransfer(d, t)).toBe(true),
  );

  it.each([
    ["Zelle payment to Pat house JPM12abcdefg", "checking"],
    ["Zelle payment from Sam Example 30000000002", "checking"],
    ["TO Chase Card Ending IN 9876", "checking"],
    [
      "APPLECARD GSBANK PAYMENT    1234567         WEB ID: 9999999999",
      "checking",
    ],
    ["CHASE CREDIT CRD AUTOPAY", "checking"],
    [
      "Acorns Round-Ups Transfer   X9KQZ41         WEB ID: 9000000001",
      "checking",
    ],
    ["Payment Thank You-Mobile", "checking"],
    [
      "Real Time Transfer Recd From Aba/contr Bnk-021000021 From: Venmo Ref: 1",
      "checking",
    ],
    ["KROGER #1234", "checking"],
  ])("%s on %s is spending or income, not a transfer", (d, t) =>
    expect(isOwnTransfer(d, t)).toBe(false),
  );

  it("rule-marks by account type: card-side wording only counts on credit accounts", () => {
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
    db.insert(transactions)
      .values([
        {
          accountId: chk.id,
          date: "2026-03-05",
          amountCents: -32500,
          rawDescription: "Zelle payment to Pat house JPM12abcdefg",
          merchant: "Pat House",
          dedupeHash: "a",
        },
        {
          accountId: chk.id,
          date: "2026-03-06",
          amountCents: 120000,
          rawDescription: "Online Transfer from CHK ...4321 transaction#: 1",
          merchant: "Online Transfer From Chk",
          dedupeHash: "b",
        },
        {
          accountId: card.id,
          date: "2026-03-07",
          amountCents: 9900,
          rawDescription: "AUTOMATIC PAYMENT - THANK YOU",
          merchant: "Automatic Payment",
          dedupeHash: "c",
        },
        {
          accountId: chk.id,
          date: "2026-03-08",
          amountCents: -9900,
          rawDescription: "Payment Thank You-Mobile",
          merchant: "Payment",
          dedupeHash: "d",
        },
      ])
      .run();
    const res = applyTransfers(db);
    expect(res.paired).toBe(1); // c <-> d by amount
    const rows = db.select().from(transactions).all();
    expect(mustFind(rows, (r) => r.dedupeHash === "a").isTransfer).toBe(false);
    expect(mustFind(rows, (r) => r.dedupeHash === "b")).toMatchObject({
      isTransfer: true,
      reviewed: false, // rule-marked: only a guess, left open for rerunDetection
    });
    expect(mustFind(rows, (r) => r.dedupeHash === "c")).toMatchObject({
      isTransfer: true,
      reviewed: true, // paired: both legs matched, so confirmed
    });
    expect(mustFind(rows, (r) => r.dedupeHash === "d")).toMatchObject({
      isTransfer: true,
      reviewed: true,
    });
    expect(res.ruleMarked).toBe(1);
  });
});

describe("applyTransfers", () => {
  it("writes pairs and marks rows", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [a, b] = db
      .insert(accounts)
      .values([
        { name: "Chk", type: "checking" },
        { name: "Card", type: "credit" },
      ])
      .returning()
      .all();
    db.insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-03-05",
          amountCents: -50000,
          rawDescription: "CHASE CREDIT CRD AUTOPAY",
          merchant: "Chase",
          dedupeHash: "h1",
        },
        {
          accountId: b.id,
          date: "2026-03-05",
          amountCents: 50000,
          rawDescription: "Payment Thank You",
          merchant: "Payment",
          dedupeHash: "h2",
        },
        {
          accountId: a.id,
          date: "2026-03-06",
          amountCents: -1000,
          rawDescription: "ONLINE TRANSFER TO SAV ...8800",
          merchant: "Online Transfer",
          dedupeHash: "h3",
        },
        {
          accountId: a.id,
          date: "2026-03-06",
          amountCents: -1000,
          rawDescription: "KROGER",
          merchant: "Kroger",
          dedupeHash: "h4",
        },
      ])
      .run();
    const res = applyTransfers(db);
    expect(res).toEqual({ paired: 1, ruleMarked: 1 });
    expect(db.select().from(transferPairs).all()).toHaveLength(1);
    const rows = db.select().from(transactions).all();
    expect(
      rows
        .filter((r) => r.isTransfer)
        .map((r) => r.rawDescription)
        .sort(),
    ).toEqual([
      "CHASE CREDIT CRD AUTOPAY",
      "ONLINE TRANSFER TO SAV ...8800",
      "Payment Thank You",
    ]);
    // paired legs (h1, h2) are confirmed; the rule-marked leg (h3) is not.
    expect(mustFind(rows, (r) => r.dedupeHash === "h1").reviewed).toBe(true);
    expect(mustFind(rows, (r) => r.dedupeHash === "h2").reviewed).toBe(true);
    expect(mustFind(rows, (r) => r.dedupeHash === "h3").reviewed).toBe(false);
  });

  it("is idempotent and honors accountIds", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [a, b] = db
      .insert(accounts)
      .values([
        { name: "Chk", type: "checking" },
        { name: "Card", type: "credit" },
      ])
      .returning()
      .all();
    db.insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-03-05",
          amountCents: -50000,
          rawDescription: "PAY",
          merchant: "Pay",
          dedupeHash: "i1",
        },
        {
          accountId: b.id,
          date: "2026-03-05",
          amountCents: 50000,
          rawDescription: "Payment Thank You",
          merchant: "Payment",
          dedupeHash: "i2",
        },
      ])
      .run();
    expect(applyTransfers(db, [])).toEqual({ paired: 0, ruleMarked: 0 });
    expect(applyTransfers(db)).toEqual({ paired: 1, ruleMarked: 0 });
    expect(applyTransfers(db)).toEqual({ paired: 0, ruleMarked: 0 });
    expect(db.select().from(transferPairs).all()).toHaveLength(1);
  });
});
