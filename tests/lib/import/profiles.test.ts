import { describe, expect, it } from "vitest";
import { BUILTIN_PROFILES, headerSignature } from "@/lib/import/profiles";

describe("headerSignature", () => {
  it("is order- and case-insensitive", () => {
    expect(headerSignature(["Date", " Amount"])).toBe(
      headerSignature(["amount", "date"]),
    );
  });
  it("builtin signatures are unique", () => {
    const sigs = BUILTIN_PROFILES.map((p) => p.headerSignature);
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});
