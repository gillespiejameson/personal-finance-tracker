import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { plannedExpenses } from "@/lib/db/schema";
import { loadWallSummary } from "@/lib/wall/load";

describe("loadWallSummary", () => {
  it("returns an empty panel for a fresh database", () => {
    const s = loadWallSummary(
      openDb(":memory:"),
      new Date("2026-09-10T12:00:00Z"),
    );
    expect(s.generatedAt).toBe("2026-09-10T12:00:00.000Z");
    expect(s.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.gateOpen).toBe(false);
    expect(s.safeToSpend).toBeNull();
    expect(s.budget).toBeNull();
    expect(s.bills).toEqual({ due: [], dueTotalCents: 0 });
    expect(s.review).toEqual({ count: 0, streakWeeks: 0, weeklyDue: true });
    expect(s.nextPlanned).toBeNull();
    expect(s.alerts).toEqual({ count: 0 });
  });
  it("surfaces the earliest upcoming planned expense", () => {
    const db = openDb(":memory:");
    db.insert(plannedExpenses)
      .values([
        {
          name: "Far",
          amountCents: 50000,
          dueDate: "2099-06-01",
          every: "year",
        },
        {
          name: "Near",
          amountCents: 20000,
          dueDate: "2099-03-01",
          every: "year",
        },
      ])
      .run();
    expect(loadWallSummary(db, new Date()).nextPlanned).toEqual({
      name: "Near",
      cents: 20000,
      date: "2099-03-01",
    });
  });
});
