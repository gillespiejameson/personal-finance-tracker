import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanMerchant, payeeFromP2P } from "@/lib/normalize/merchant";

const cases = fs
  .readFileSync("tests/fixtures/merchants.txt", "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim() !== "" && !l.startsWith("#") && !l.startsWith("~"))
  .map((l) => {
    const i = l.lastIndexOf(" => ");
    return { raw: l.slice(0, i), expected: l.slice(i + 4).trim() };
  });

describe("cleanMerchant fixture", () => {
  it.each(cases)("$raw", ({ raw, expected }) => {
    expect(cleanMerchant(raw)).toBe(expected);
  });
  it("never returns an empty string", () => {
    expect(cleanMerchant("")).toBe("Unknown");
    expect(cleanMerchant(" 12345 ")).toBe("Unknown");
  });
});

describe("cleanMerchant with a learned city set", () => {
  const cities = new Set(["springfield"]);

  it("drops a local city once it is known, and never eats a real word", () => {
    expect(cleanMerchant("H-E-B #042 SPRINGFIELD IL", { cities })).toBe(
      "H-E-B",
    );
    expect(cleanMerchant("COPPER KETTLE TAP SPRINGFIELD IL", { cities })).toBe(
      "Copper Kettle Tap",
    );
    // Same input, no city set: the city is kept rather than guessed at.
    expect(cleanMerchant("H-E-B #042 SPRINGFIELD IL")).toBe(
      "H-E-B Springfield",
    );
    // "Beauty" is not a city in any set, so it survives either way.
    expect(cleanMerchant("SP VERDA BEAUTY 184-12345678 CA", { cities })).toBe(
      "Verda Beauty",
    );
  });

  it("strips a well-known city without being taught it", () => {
    expect(cleanMerchant("AMAZON.COM SEATTLE WA")).toBe("Amazon");
    expect(cleanMerchant("SQ *BRIGHTWORKS Chicago IL")).toBe("Brightworks");
  });
});

describe("payeeFromP2P", () => {
  it("extracts the raw payee", () => {
    expect(payeeFromP2P("Zelle payment to Pat house JPM12abcdefg")).toBe(
      "Pat house JPM12abcdefg",
    );
    expect(payeeFromP2P("Zelle payment from Sam Example 30000000002")).toBe(
      "Sam Example 30000000002",
    );
    expect(payeeFromP2P("KROGER #1234")).toBeNull();
  });
});
