import { describe, expect, it } from "vitest";
import { accountIdSchema, accountInput } from "@/lib/accounts/schema";

describe("account schemas", () => {
  it("normalizes blank institution to null and trims", () => {
    expect(
      accountInput.parse({ name: "A", type: "checking", institution: "" })
        .institution,
    ).toBeNull();
    expect(
      accountInput.parse({
        name: "A",
        type: "checking",
        institution: "  Chase ",
      }).institution,
    ).toBe("Chase");
    expect(accountInput.parse({ name: "A", type: "checking" }).color).toBe(
      "#0A84FF",
    );
  });
  it("rejects bad input", () => {
    expect(() => accountInput.parse({ name: "", type: "checking" })).toThrow();
    expect(() => accountInput.parse({ name: "A", type: "wallet" })).toThrow();
    expect(() =>
      accountInput.parse({ name: "A", type: "cash", color: "blue" }),
    ).toThrow();
    expect(() => accountIdSchema.parse(0)).toThrow();
    expect(() => accountIdSchema.parse("1")).toThrow();
    expect(accountIdSchema.parse(7)).toBe(7);
  });
});
