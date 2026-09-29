import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { goals } from "@/lib/db/schema";

describe("goals schema", () => {
  it("stores start_date and starting_cents", () => {
    const db = openDb(":memory:");
    db.insert(goals)
      .values({
        name: "Trip",
        targetCents: 200000,
        startDate: "2026-09-06",
        startingCents: 5000,
      })
      .run();
    expect(db.select().from(goals).get()).toMatchObject({
      startDate: "2026-09-06",
      startingCents: 5000,
    });
  });
});
