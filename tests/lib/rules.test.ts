import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { renameCategory } from "@/lib/categories/manage";
import { openDb } from "@/lib/db/client";
import { accounts, rules, transactions } from "@/lib/db/schema";
import { BUILTIN_RULES, ensureBuiltinRules } from "@/lib/rules/builtin";
import {
  applyRules,
  ensureUserRule,
  matchRule,
  pickRule,
  previewRule,
} from "@/lib/rules/engine";
import { mustFind } from "../helpers";

const cat = (db: ReturnType<typeof openDb>, name: string) => {
  const id = findCategoryId(db, name);
  if (id === undefined) throw new Error(`missing category ${name}`);
  return id;
};

function seed(db: ReturnType<typeof openDb>) {
  ensureDefaultCategories(db);
  const [a] = db
    .insert(accounts)
    .values({ name: "Chk", type: "checking" })
    .returning()
    .all();
  const [b] = db
    .insert(accounts)
    .values({ name: "Card", type: "credit" })
    .returning()
    .all();
  db.insert(transactions)
    .values([
      {
        accountId: a.id,
        date: "2026-03-01",
        amountCents: -6666,
        rawDescription: "H-E-B #042 SPRINGFIELD IL",
        merchant: "H-E-B",
        dedupeHash: "1",
      },
      {
        accountId: a.id,
        date: "2026-03-02",
        amountCents: 248312,
        rawDescription: "Globex Corp -PAYROLL",
        merchant: "Globex Corp Payroll",
        dedupeHash: "2",
      },
      {
        accountId: a.id,
        date: "2026-03-03",
        amountCents: -350000,
        rawDescription: "APPLECARD GSBANK PAYMENT 1234567 WEB ID: 9999999999",
        merchant: "Apple Card Payment",
        dedupeHash: "3",
      },
      {
        accountId: a.id,
        date: "2026-03-04",
        amountCents: -557,
        rawDescription: "Acorns Round-Ups Transfer X9KQZ41 WEB ID: 9000000001",
        merchant: "Acorns",
        dedupeHash: "4",
      },
      {
        accountId: a.id,
        date: "2026-03-05",
        amountCents: -1200,
        rawDescription: "Monthly Service Fee",
        merchant: "Monthly Service Fee",
        dedupeHash: "5",
      },
      {
        accountId: b.id,
        date: "2026-03-06",
        amountCents: -1549,
        rawDescription: "NETFLIX.COM",
        merchant: "Netflix",
        dedupeHash: "6",
      },
      {
        accountId: a.id,
        date: "2026-03-07",
        amountCents: -32500,
        rawDescription: "Zelle payment to Pat house JPM12",
        merchant: "Pat House",
        dedupeHash: "7",
      },
      {
        accountId: a.id,
        date: "2026-03-08",
        amountCents: -5000,
        rawDescription: "SOMETHING",
        merchant: "Something",
        dedupeHash: "8",
        isTransfer: true,
      },
    ])
    .run();
  return { a, b };
}

describe("matchRule / pickRule", () => {
  const base = {
    id: 1,
    priority: 100,
    matchType: "contains" as const,
    pattern: "kroger",
    field: "merchant" as const,
    minCents: null,
    maxCents: null,
    accountId: null,
    categoryId: 1,
    enabled: true,
    hitCount: 0,
    lastHit: null,
    builtin: false,
    direction: "any" as const,
  };
  const t = {
    id: 9,
    merchant: "Kroger Fuel",
    rawDescription: "KROGER FUEL CTR #2763",
    amountCents: -4500,
    accountId: 1,
  };
  it("contains is case-insensitive on the chosen field", () => {
    expect(matchRule(base, t)).toBe(true);
    expect(matchRule({ ...base, field: "raw", pattern: "fuel ctr" }, t)).toBe(
      true,
    );
    expect(matchRule({ ...base, pattern: "fuel ctr" }, t)).toBe(false);
  });
  it("contains matches are anchored at both word start and word end", () => {
    const appleRule = { ...base, pattern: "apple" };
    expect(
      matchRule(appleRule, {
        ...t,
        merchant: "Apple",
        rawDescription: "Apple",
      }),
    ).toBe(true);
    expect(
      matchRule(appleRule, {
        ...t,
        merchant: "Apple Store",
        rawDescription: "Apple Store",
      }),
    ).toBe(true);
    expect(
      matchRule(appleRule, {
        ...t,
        merchant: "Applebee's",
        rawDescription: "Applebee's",
      }),
    ).toBe(false);
  });
  it("amount range and account narrow the match; amounts compare on absolute cents", () => {
    expect(matchRule({ ...base, minCents: 4000, maxCents: 5000 }, t)).toBe(
      true,
    );
    expect(matchRule({ ...base, minCents: 4600 }, t)).toBe(false);
    expect(matchRule({ ...base, accountId: 2 }, t)).toBe(false);
  });
  it("regex, disabled rules, priority and id ordering", () => {
    expect(
      matchRule(
        { ...base, matchType: "regex", pattern: "^kroger\\s+fuel$" },
        t,
      ),
    ).toBe(true);
    expect(matchRule({ ...base, matchType: "regex", pattern: "(" }, t)).toBe(
      false,
    );
    const r1 = { ...base, id: 1, priority: 200, categoryId: 11 };
    const r2 = { ...base, id: 2, priority: 100, categoryId: 22 };
    const r3 = {
      ...base,
      id: 3,
      priority: 100,
      categoryId: 33,
      enabled: false,
    };
    expect(pickRule([r1, r2, r3], t)?.categoryId).toBe(22);
  });
  it("direction requires the sign to match; any skips the check", () => {
    const inflow = { ...t, amountCents: 4500 };
    expect(matchRule({ ...base, direction: "out" }, t)).toBe(true);
    expect(matchRule({ ...base, direction: "out" }, inflow)).toBe(false);
    expect(matchRule({ ...base, direction: "in" }, t)).toBe(false);
    expect(matchRule({ ...base, direction: "in" }, inflow)).toBe(true);
    expect(matchRule({ ...base, direction: "any" }, t)).toBe(true);
    expect(matchRule({ ...base, direction: "any" }, inflow)).toBe(true);
    // A spec without a direction behaves like "any".
    expect(matchRule({ ...base, direction: undefined }, inflow)).toBe(true);
  });
});

describe("builtin income rules are inflow-only", () => {
  it("payroll matches a deposit but not a debit with the same description", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinRules(db);
    const all = db.select().from(rules).all();
    const payroll = mustFind(
      all,
      (r) => r.pattern === "payroll",
      "the payroll rule",
    );
    expect(payroll.direction).toBe("in");
    const base = {
      id: 1,
      merchant: "Globex Corp Payroll",
      rawDescription: "Globex Corp -PAYROLL",
      accountId: 1,
    };
    expect(matchRule(payroll, { ...base, amountCents: 248312 })).toBe(true);
    expect(matchRule(payroll, { ...base, amountCents: -98765 })).toBe(false);
    expect(pickRule(all, { ...base, amountCents: -98765 })).toBeUndefined();
    // Every rule aimed at an income leaf is inflow-only, and nothing else is.
    const income = (r: { category: string }) =>
      r.category.startsWith("income/");
    for (const r of BUILTIN_RULES)
      expect(r.direction ?? "any").toBe(income(r) ? "in" : "any");
    expect(all.filter((r) => r.direction === "in")).toHaveLength(
      BUILTIN_RULES.filter(income).length,
    );
  });

  it("re-seeding writes direction onto an existing builtin row", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinRules(db);
    const payroll = mustFind(
      db.select().from(rules).all(),
      (r) => r.pattern === "payroll",
      "the payroll rule",
    );
    // A row seeded before direction existed carries the column default.
    db.update(rules)
      .set({ direction: "any" })
      .where(eq(rules.id, payroll.id))
      .run();
    ensureBuiltinRules(db);
    expect(
      mustFind(db.select().from(rules).all(), (r) => r.id === payroll.id)
        .direction,
    ).toBe("in");
  });
});

describe("applyRules with builtin rules", () => {
  it("categorizes uncategorized, non-transfer, unreviewed rows and counts hits", () => {
    const db = openDb(":memory:");
    seed(db);
    ensureBuiltinRules(db);
    ensureBuiltinRules(db);
    expect(db.select().from(rules).all()).toHaveLength(BUILTIN_RULES.length);
    const { applied } = applyRules(db);
    const rows = db.select().from(transactions).all();
    const by = (h: string) =>
      mustFind(rows, (r) => r.dedupeHash === h, `row ${h}`);
    expect(by("1").categoryId).toBe(cat(db, "Groceries"));
    expect(by("2").categoryId).toBe(cat(db, "Paycheck"));
    expect(by("3").categoryId).toBe(cat(db, "Card payments"));
    expect(by("4").categoryId).toBe(cat(db, "Savings & investing"));
    expect(by("5").categoryId).toBe(cat(db, "Interest & fees"));
    expect(by("6").categoryId).toBe(cat(db, "Subscriptions"));
    expect(by("7").categoryId).toBeNull(); // people are left to the user
    expect(by("8").categoryId).toBeNull(); // transfer untouched
    expect(applied).toBe(6);
    expect(rows.every((r) => !r.reviewed)).toBe(true);
    const hit = mustFind(
      db.select().from(rules).all(),
      (r) => r.hitCount > 0,
      "a rule with hits",
    );
    expect(hit.lastHit).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(applyRules(db).applied).toBe(0);
  });

  it("does not override reviewed rows unless asked, and previewRule counts matches", () => {
    const db = openDb(":memory:");
    seed(db);
    ensureBuiltinRules(db);
    const groceries = cat(db, "Groceries");
    const other = cat(db, "General");
    db.update(transactions).set({ categoryId: other, reviewed: true }).run();
    expect(applyRules(db, { onlyUncategorized: false }).applied).toBe(0);
    expect(
      previewRule(db, {
        pattern: "h-e-b",
        field: "merchant",
        matchType: "contains",
      }),
    ).toBe(1);
    expect(
      previewRule(db, {
        pattern: "payroll",
        field: "raw",
        matchType: "contains",
      }),
    ).toBe(1);
    // The Review "always" preview passes the item's direction: a rule learned
    // from a deposit must not count the same payee's debits.
    expect(
      previewRule(db, {
        pattern: "payroll",
        field: "raw",
        matchType: "contains",
        direction: "in",
      }),
    ).toBe(1);
    expect(
      previewRule(db, {
        pattern: "payroll",
        field: "raw",
        matchType: "contains",
        direction: "out",
      }),
    ).toBe(0);
    db.update(transactions).set({ reviewed: false }).run();
    expect(
      applyRules(db, { onlyUncategorized: false, transactionIds: [1] }).applied,
    ).toBe(1);
    expect(
      mustFind(db.select().from(transactions).all(), (r) => r.id === 1)
        .categoryId,
    ).toBe(groceries);
  });

  it("generic brand rules do not swallow other merchants", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinRules(db);
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    db.insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-03-01",
          amountCents: -2500,
          rawDescription: "APPLEBEES 1234",
          merchant: "Applebee's",
          dedupeHash: "r1",
        },
        {
          accountId: a.id,
          date: "2026-03-02",
          amountCents: -999,
          rawDescription: "APPLE.COM/BILL",
          merchant: "Apple",
          dedupeHash: "r2",
        },
        {
          accountId: a.id,
          date: "2026-03-03",
          amountCents: -1500,
          rawDescription: "SEASHELL CAFE",
          merchant: "Seashell Cafe",
          dedupeHash: "r3",
        },
        {
          accountId: a.id,
          date: "2026-03-04",
          amountCents: -4000,
          rawDescription: "SHELL OIL 123",
          merchant: "Shell",
          dedupeHash: "r4",
        },
        {
          accountId: a.id,
          date: "2026-03-05",
          amountCents: -800,
          rawDescription: "NESTLE TOLL HOUSE",
          merchant: "Nestle Toll House",
          dedupeHash: "r5",
        },
        {
          accountId: a.id,
          date: "2026-03-06",
          amountCents: -350,
          rawDescription: "METRO TOLL PAYMENT",
          merchant: "Metro Toll Payment",
          dedupeHash: "r6",
        },
      ])
      .run();
    applyRules(db);
    const rows = db.select().from(transactions).all();
    const by = (h: string) =>
      mustFind(rows, (r) => r.dedupeHash === h, `row ${h}`);
    // "Applebee's" and "Seashell Cafe" are now caught by the restaurant rules,
    // but neither is swallowed by the brand rule its name contains.
    expect(by("r1").categoryId).toBe(cat(db, "Restaurants"));
    expect(by("r1").categoryId).not.toBe(cat(db, "Subscriptions"));
    expect(by("r2").categoryId).toBe(cat(db, "Subscriptions"));
    expect(by("r3").categoryId).toBe(cat(db, "Restaurants"));
    expect(by("r3").categoryId).not.toBe(cat(db, "Fuel"));
    expect(by("r4").categoryId).toBe(cat(db, "Fuel"));
    expect(by("r5").categoryId).toBe(cat(db, "Repairs, parking & transit")); // "Toll" is still a word here: accepted limitation
    expect(by("r6").categoryId).toBe(cat(db, "Repairs, parking & transit"));
  });

  it("fee rules outrank payee rules, and eating out is caught by chain or keyword", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinRules(db);
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    const row = (
      hash: string,
      merchant: string,
      rawDescription = merchant,
    ) => ({
      accountId: a.id,
      date: "2026-03-01",
      amountCents: -1500,
      rawDescription,
      merchant,
      dedupeHash: hash,
    });
    db.insert(transactions)
      .values([
        row("f1", "Overdraft Fee", "OVERDRAFT FEE FOR CREDIT CRD AUTOPAY"),
        row("f2", "Fuzzys"),
        row("f3", "Elenas Cafe & Tortilla"),
        row("f4", "Blue Bottle Coffee"),
        row("f5", "Geico"),
        row("f6", "Oak Ridge Realty"),
        row("f7", "Prime Video", "AMAZON PRIME VIDEO 888-802-3080 WA"),
        row("f8", "7-Eleven"),
      ])
      .run();
    applyRules(db);
    const rows = db.select().from(transactions).all();
    const by = (h: string) =>
      mustFind(rows, (r) => r.dedupeHash === h, `row ${h}`);
    // The fee rule now sits at priority 15, ahead of the card-payment rules
    // this description also matches.
    expect(by("f1").categoryId).toBe(cat(db, "Interest & fees"));
    expect(by("f2").categoryId).toBe(cat(db, "Restaurants"));
    expect(by("f3").categoryId).toBe(cat(db, "Restaurants"));
    expect(by("f4").categoryId).toBe(cat(db, "Coffee & takeout"));
    expect(by("f5").categoryId).toBe(cat(db, "Insurance"));
    expect(by("f6").categoryId).toBe(cat(db, "Rent/Mortgage"));
    expect(by("f7").categoryId).toBe(cat(db, "Subscriptions"));
    expect(by("f8").categoryId).toBe(cat(db, "Fuel"));
  });

  it("re-seeding brings an existing builtin rule's priority up to date", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinRules(db);
    const fee = mustFind(
      db.select().from(rules).all(),
      (r) => r.pattern === "monthly service fee",
      "the monthly service fee rule",
    );
    db.update(rules)
      .set({ priority: 20, enabled: false })
      .where(eq(rules.id, fee.id))
      .run();
    ensureBuiltinRules(db);
    const after = mustFind(
      db.select().from(rules).all(),
      (r) => r.id === fee.id,
    );
    expect(after.priority).toBe(15);
    // A rule switched off by archiving its category stays off.
    expect(after.enabled).toBe(false);
  });

  it("ensureBuiltinRules prunes builtin rules that no longer exist and keeps user rules", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinRules(db);
    const groceries = cat(db, "Groceries");
    db.insert(rules)
      .values({
        pattern: "obsolete-pattern",
        categoryId: groceries,
        builtin: true,
      })
      .run();
    db.insert(rules)
      .values({ pattern: "my own rule", categoryId: groceries, builtin: false })
      .run();
    ensureBuiltinRules(db);
    const all = db.select().from(rules).all();
    expect(all.filter((r) => r.builtin)).toHaveLength(BUILTIN_RULES.length);
    expect(all.some((r) => r.pattern === "obsolete-pattern")).toBe(false);
    expect(all.some((r) => r.pattern === "my own rule" && !r.builtin)).toBe(
      true,
    );
  });

  it("survives a renamed default category and keeps categorizing into it", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const groceries = cat(db, "Groceries");
    const renamed = renameCategory(db, groceries, "Food shopping");
    expect(renamed.ok).toBe(true);
    // Builtin rules resolve categories by seed key, not by name, so the rename
    // above must not make ensureBuiltinRules throw.
    expect(() => ensureBuiltinRules(db)).not.toThrow();
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    db.insert(transactions)
      .values({
        accountId: a.id,
        date: "2026-03-01",
        amountCents: -6666,
        rawDescription: "H-E-B #042 SPRINGFIELD IL",
        merchant: "H-E-B",
        dedupeHash: "1",
      })
      .run();
    applyRules(db);
    const row = mustFind(
      db.select().from(transactions).all(),
      (r) => r.dedupeHash === "1",
      "row 1",
    );
    expect(row.categoryId).toBe(groceries);
    expect(findCategoryId(db, "Food shopping")).toBe(groceries);
  });

  it("ensureUserRule is idempotent for identical rules", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const groceries = cat(db, "Groceries");
    const a = ensureUserRule(db, {
      pattern: " Kroger ",
      field: "merchant",
      categoryId: groceries,
    });
    const b = ensureUserRule(db, {
      pattern: "kroger",
      field: "merchant",
      categoryId: groceries,
    });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    expect(
      db
        .select()
        .from(rules)
        .all()
        .filter((r) => !r.builtin),
    ).toHaveLength(1);
  });

  it("ensureUserRule stores a direction and updates it on an existing rule", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const groceries = cat(db, "Groceries");
    const a = ensureUserRule(db, {
      pattern: "kroger",
      field: "merchant",
      categoryId: groceries,
    });
    const row = () =>
      mustFind(db.select().from(rules).all(), (r) => r.id === a.id);
    expect(row().direction).toBe("any");
    const b = ensureUserRule(
      db,
      { pattern: "Kroger", field: "merchant", categoryId: groceries },
      { direction: "out" },
    );
    expect(b).toEqual({ id: a.id, created: false });
    expect(row().direction).toBe("out");
    const c = ensureUserRule(
      db,
      { pattern: "acme", field: "merchant", categoryId: groceries },
      { direction: "in" },
    );
    expect(c.created).toBe(true);
    expect(
      mustFind(db.select().from(rules).all(), (r) => r.id === c.id).direction,
    ).toBe("in");
  });
});
