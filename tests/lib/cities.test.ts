import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";
import { loadCities } from "@/lib/normalize/cities";

function seed(raws: string[]) {
  const db = openDb(":memory:");
  const [a] = db
    .insert(accounts)
    .values({ name: "A", type: "checking" })
    .returning()
    .all();
  db.insert(transactions)
    .values(
      raws.map((raw, i) => ({
        accountId: a.id,
        date: "2026-06-01",
        amountCents: -100,
        rawDescription: raw,
        merchant: "X",
        dedupeHash: `h${i}`,
      })),
    )
    .run();
  return db;
}

describe("loadCities", () => {
  it("keeps a word seen before a state code at least three times", () => {
    const db = seed([
      "H-E-B #042 SPRINGFIELD IL",
      "QT 417 SPRINGFIELD IL",
      "HOBBYLOBBY SPRINGFIELD IL 09/02",
      "SP VERDA BEAUTY 184-12345678 CA",
      "SPAFF * PAINTED BIRD 855-555-0147 CA",
    ]);
    const cities = loadCities(db);
    expect(cities.has("springfield")).toBe(true);
    // Seen once each, so neither is mistaken for a place.
    expect(cities.has("beauty")).toBe(false);
    expect(cities.has("organ")).toBe(false);
  });

  it("counts rows a caller is about to import", () => {
    const db = seed(["H-E-B #042 SPRINGFIELD IL"]);
    expect(loadCities(db).has("springfield")).toBe(false);
    expect(
      loadCities(db, [
        "QT 417 SPRINGFIELD IL",
        "TARGET T-2045 SPRINGFIELD IL 07/12",
      ]).has("springfield"),
    ).toBe(true);
  });

  it("ignores lowercase words that only look like state codes", () => {
    const db = seed([
      "SOMETHING TASTY or",
      "SOMETHING TASTY or",
      "SOMETHING TASTY or",
    ]);
    expect(loadCities(db).size).toBe(0);
  });
});
