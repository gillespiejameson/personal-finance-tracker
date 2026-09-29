import { describe, expect, it } from "vitest";
import { formatCents, parseAmountToCents, sumCents } from "@/lib/money";

describe("parseAmountToCents", () => {
  it.each([
    ["1,234.56", 123456],
    ["-42.10", -4210],
    ["(42.10)", -4210],
    ["$12", 1200],
    ["−5", -500],
    ["0.1", 10],
    ["  7.005 ", 701],
  ])("parses %s", (raw, cents) => expect(parseAmountToCents(raw)).toBe(cents));
  it("returns null for junk", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
  });
});

describe("formatCents", () => {
  it("negatives use a true minus", () =>
    expect(formatCents(-4210)).toBe("−$42.10"));
  it("positives have no sign by default", () =>
    expect(formatCents(124000)).toBe("$1,240.00"));
  it("positives get plus when asked", () =>
    expect(formatCents(124000, { sign: "always" })).toBe("+$1,240.00"));
  it("never shows sign when told", () =>
    expect(formatCents(-5, { sign: "never" })).toBe("$0.05"));
});

describe("sumCents", () => {
  it("sums exactly", () => expect(sumCents([1, 2, -3, 1000])).toBe(1000));
});
