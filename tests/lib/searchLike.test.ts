import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";
import { escapeLike } from "@/lib/sqlLike";

describe("LIKE with ESCAPE", () => {
  it("underscore in the query matches literally", () => {
    const db = openDb(":memory:");
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
          rawDescription: "SQ *COFFEE_SHOP",
          merchant: "Coffee_shop",
          dedupeHash: "a",
        },
        {
          accountId: a.id,
          date: "2026-03-01",
          amountCents: -100,
          rawDescription: "SQ *COFFEEXSHOP",
          merchant: "Coffeexshop",
          dedupeHash: "b",
        },
      ])
      .run();
    const pattern = `%${escapeLike("coffee_")}%`;
    const rows = db
      .select({ id: transactions.id })
      .from(transactions)
      .where(sql`${transactions.merchant} LIKE ${pattern} ESCAPE '\\'`)
      .all();
    expect(rows).toHaveLength(1);
  });
});
