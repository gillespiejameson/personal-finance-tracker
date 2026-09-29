import { describe, expect, it } from "vitest";
import { canSaveProfile } from "@/lib/import/profileGuard";
import { BUILTIN_PROFILES } from "@/lib/import/profiles";

describe("canSaveProfile", () => {
  it("refuses builtins and anything sharing a builtin header signature", () => {
    const chase = BUILTIN_PROFILES[0];
    expect(canSaveProfile(chase, BUILTIN_PROFILES)).toBe(false);
    expect(
      canSaveProfile(
        { ...chase, builtin: false, name: "Mine" },
        BUILTIN_PROFILES,
      ),
    ).toBe(false);
  });
  it("allows a custom signature", () => {
    const chase = BUILTIN_PROFILES[0];
    expect(
      canSaveProfile(
        {
          ...chase,
          builtin: false,
          name: "My CU",
          headerSignature: "in|out|what|when",
        },
        BUILTIN_PROFILES,
      ),
    ).toBe(true);
  });
});
