import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { recurring } from "@/lib/db/schema";

describe("recurring schema", () => {
  it("stores cadence, occurrences and first_seen", () => {
    const db = openDb(":memory:");
    db.insert(recurring)
      .values({
        merchant: "Geico",
        cadence: "monthly",
        occurrences: 3,
        firstSeen: "2026-06-12",
        avgCents: -31257,
        intervalDays: 28,
        lastSeen: "2026-08-10",
        nextExpected: "2026-09-07",
      })
      .run();
    expect(db.select().from(recurring).get()).toMatchObject({
      cadence: "monthly",
      occurrences: 3,
      firstSeen: "2026-06-12",
    });
  });
});
