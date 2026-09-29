import { describe, expect, it } from "vitest";
import { escapeLike, parseIdParam } from "@/lib/sqlLike";

describe("escapeLike", () => {
  it("escapes %, _ and backslash", () =>
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\"));
  it("leaves plain text alone", () =>
    expect(escapeLike("kroger")).toBe("kroger"));
});

describe("parseIdParam", () => {
  it.each([
    ["7", 7],
    ["0", undefined],
    ["abc", undefined],
    ["1.5", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("%s", (v, out) => expect(parseIdParam(v as string | undefined)).toBe(out));
});
