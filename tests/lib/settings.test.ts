import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";

describe("settings", () => {
  it("round-trips JSON values and falls back when missing", () => {
    const db = openDb(":memory:");
    expect(getSetting(db, "payday", { kind: "biweekly" })).toEqual({
      kind: "biweekly",
    });
    setSetting(db, "payday", { kind: "monthly", day: 1 });
    expect(getSetting(db, "payday", null)).toEqual({
      kind: "monthly",
      day: 1,
    });
    setSetting(db, "payday", true);
    expect(getSetting(db, "payday", false)).toBe(true);
  });
  it("deletes a key so the fallback comes back", () => {
    const db = openDb(":memory:");
    setSetting(db, "wall_token_hash", "abc");
    expect(getSetting<string | null>(db, "wall_token_hash", null)).toBe("abc");
    deleteSetting(db, "wall_token_hash");
    expect(getSetting<string | null>(db, "wall_token_hash", null)).toBeNull();
    deleteSetting(db, "wall_token_hash"); // deleting a missing key is a no-op
    expect(getSetting<string | null>(db, "wall_token_hash", null)).toBeNull();
  });
});
