import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/import/csv";
import { detectDateFormat, detectProfile } from "@/lib/import/detect";
import { BUILTIN_PROFILES } from "@/lib/import/profiles";

const headersOf = (f: string) =>
  parseCsv(fs.readFileSync(`tests/fixtures/${f}`, "utf8")).headers;

describe("detectProfile", () => {
  it("finds Chase card", () =>
    expect(detectProfile(headersOf("chase.csv"), BUILTIN_PROFILES)?.name).toBe(
      "Chase (card)",
    ));
  it("finds Bank of America", () =>
    expect(detectProfile(headersOf("bofa.csv"), BUILTIN_PROFILES)?.name).toBe(
      "Bank of America",
    ));
  it("finds Amex", () =>
    expect(detectProfile(headersOf("amex.csv"), BUILTIN_PROFILES)?.name).toBe(
      "American Express",
    ));
  it("returns null for unknown", () =>
    expect(
      detectProfile(headersOf("unknown.csv"), BUILTIN_PROFILES),
    ).toBeNull());
});

describe("detectDateFormat", () => {
  it("ISO", () =>
    expect(detectDateFormat(["2026-03-04"])).toEqual({
      format: "YMD",
      ambiguous: false,
    }));
  it("day > 12 in first slot means DMY", () =>
    expect(detectDateFormat(["31/03/2026", "01/04/2026"])).toEqual({
      format: "DMY",
      ambiguous: false,
    }));
  it("day > 12 in second slot means MDY", () =>
    expect(detectDateFormat(["03/14/2026"])).toEqual({
      format: "MDY",
      ambiguous: false,
    }));
  it("all ≤12 is ambiguous, defaults MDY", () =>
    expect(detectDateFormat(["03/04/2026", "05/06/2026"])).toEqual({
      format: "MDY",
      ambiguous: true,
    }));
});
