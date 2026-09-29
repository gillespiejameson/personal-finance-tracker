import { describe, expect, it } from "vitest";
import { ensureDefaultCategories } from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { accounts, merchantAliases, transactions } from "@/lib/db/schema";
import {
  BUILTIN_ALIASES,
  createAlias,
  ensureBuiltinAliases,
  loadAliases,
  reapplyMerchants,
  resolveMerchant,
  validateAlias,
} from "@/lib/normalize/aliases";

describe("aliases", () => {
  it("builtin aliases are seeded once and match raw or cleaned text", () => {
    const db = openDb(":memory:");
    ensureBuiltinAliases(db);
    ensureBuiltinAliases(db);
    expect(db.select().from(merchantAliases).all()).toHaveLength(
      BUILTIN_ALIASES.length,
    );
    const aliases = loadAliases(db);
    expect(resolveMerchant("HOBBYLOBBY SPRINGFIELD IL", aliases)).toBe(
      "Hobby Lobby",
    );
    expect(resolveMerchant("HOBBY-LOBBY #0321 SPRINGFIELD IL", aliases)).toBe(
      "Hobby Lobby",
    );
    expect(
      resolveMerchant("AMAZON MKTPL*381QX57 Amzn.com/bill WA", aliases),
    ).toBe("Amazon");
    expect(resolveMerchant("APPLE.COM/BILL 866-712-7753 CA", aliases)).toBe(
      "Apple",
    );
    expect(resolveMerchant("SPROUTS INSTACART.COM CA", aliases)).toBe(
      "Sprouts",
    );
    expect(resolveMerchant("SOME UNKNOWN SHOP", aliases)).toBe(
      "Some Unknown Shop",
    );
    expect(resolveMerchant("7-ELEVEN #41276 SPRINGFIELD IL", aliases)).toBe(
      "7-Eleven",
    );
    expect(resolveMerchant("7ELEVEN SPRINGFIELD IL", aliases)).toBe("7-Eleven");
    expect(resolveMerchant("7-11 STORE 3407 SPRINGFIELD IL", aliases)).toBe(
      "7-Eleven",
    );
    expect(resolveMerchant("ATT*BILL PAYMENT 800-288-2020 TX", aliases)).toBe(
      "AT&T",
    );
    expect(resolveMerchant("ATT BILL PAYMENT", aliases)).toBe("AT&T");
    expect(
      resolveMerchant("GOOGLE *WORKSPACE.SUBMA MOUNTAIN VIEW CA", aliases),
    ).toBe("Google Workspace");
    // The narrower pattern is seeded first, so it wins over "amazon".
    expect(resolveMerchant("AMAZON PRIME VIDEO 888-802-3080 WA", aliases)).toBe(
      "Prime Video",
    );
  });

  it("user aliases win over builtins and rewrite existing rows", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    ensureBuiltinAliases(db);
    const [a] = db
      .insert(accounts)
      .values({ name: "A", type: "checking" })
      .returning()
      .all();
    db.insert(transactions)
      .values([
        {
          accountId: a.id,
          date: "2026-03-01",
          amountCents: -100,
          rawDescription: "AMAZON.COM SEATTLE WA",
          merchant: "Amazon",
          dedupeHash: "h1",
        },
        {
          accountId: a.id,
          date: "2026-03-02",
          amountCents: -200,
          rawDescription: "TST*CORNER ROASTERY - Springfield IL",
          merchant: "Corner Roastery -",
          dedupeHash: "h2",
        },
      ])
      .run();
    const res = createAlias(db, {
      pattern: "corner roastery",
      merchant: "Corner Roasters",
    });
    expect(res.updated).toBe(1);
    const user = createAlias(db, {
      pattern: "amazon",
      merchant: "Bezos Store",
    });
    expect(user.updated).toBe(1);
    const rows = db.select().from(transactions).all();
    expect(rows.map((r) => r.merchant).sort()).toEqual([
      "Bezos Store",
      "Corner Roasters",
    ]);
    expect(loadAliases(db)[0].builtin).toBe(false);
    expect(reapplyMerchants(db)).toBe(0);
  });

  it("regex aliases work and invalid regexes are ignored", () => {
    const aliases = [
      {
        id: 1,
        pattern: "^kroger\\s+fuel",
        matchType: "regex" as const,
        merchant: "Kroger Fuel",
        builtin: false,
      },
      {
        id: 2,
        pattern: "(",
        matchType: "regex" as const,
        merchant: "Broken",
        builtin: false,
      },
    ];
    expect(
      resolveMerchant("KROGER FUEL CTR #2763 SPRINGFIELD IL", aliases),
    ).toBe("Kroger Fuel");
    expect(resolveMerchant("KROGER #1234", aliases)).toBe("Kroger");
  });

  it("validates patterns and anchors contains matches at a word start", () => {
    expect(validateAlias({ pattern: " " })).toMatch(/2 characters/);
    expect(validateAlias({ pattern: "((", matchType: "regex" })).toMatch(
      /not valid/,
    );
    expect(validateAlias({ pattern: "kroger" })).toBeNull();
    const db = openDb(":memory:");
    expect(() => createAlias(db, { pattern: "", merchant: "X" })).toThrow();
    ensureBuiltinAliases(db);
    const aliases = loadAliases(db);
    expect(resolveMerchant("EQT CORP UTILITIES PAYMENT", aliases)).not.toBe(
      "QuikTrip",
    );
    expect(resolveMerchant("QT 417 SPRINGFIELD IL", aliases)).toBe("QuikTrip");
    expect(resolveMerchant("SUPER QT MART", aliases)).toBe("QuikTrip");
  });

  it("anchors contains matches at a word end too", () => {
    const aliases = [
      {
        id: 1,
        pattern: "apple",
        matchType: "contains" as const,
        merchant: "Apple",
        builtin: false,
      },
    ];
    expect(resolveMerchant("Apple", aliases)).toBe("Apple");
    expect(resolveMerchant("Apple Store", aliases)).toBe("Apple");
    expect(resolveMerchant("Applebee's", aliases)).not.toBe("Apple");
  });
});
