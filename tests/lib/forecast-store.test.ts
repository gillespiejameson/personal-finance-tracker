import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { getFloor, setFloor } from "@/lib/forecast/store";

describe("forecast store", () => {
  it("round-trips the floor setting, defaulting to zero", () => {
    const db = openDb(":memory:");
    expect(getFloor(db)).toBe(0);
    setFloor(db, 150000);
    expect(getFloor(db)).toBe(150000);
  });
});
