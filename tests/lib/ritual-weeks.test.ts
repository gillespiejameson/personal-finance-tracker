import { describe, expect, it } from "vitest";
import { reviewStatus, staleness, streak, weekStart } from "@/lib/ritual/weeks";

describe("weekStart", () => {
  it("returns the Monday of the week, including Sundays and year boundaries", () => {
    expect(weekStart("2026-09-06")).toBe("2026-08-31"); // Sunday
    expect(weekStart("2026-09-07")).toBe("2026-09-07"); // Monday
    expect(weekStart("2026-09-09")).toBe("2026-09-07");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("streak", () => {
  it("counts consecutive weeks back from the current week when done, else from last week", () => {
    expect(
      streak(["2026-08-17", "2026-08-24", "2026-08-31"], "2026-09-06"),
    ).toBe(3);
    expect(streak(["2026-08-17", "2026-08-24"], "2026-09-06")).toBe(2); // this week not done yet, last week done
    expect(streak(["2026-08-10", "2026-08-17"], "2026-09-06")).toBe(0); // gap of one week
    expect(streak([], "2026-09-06")).toBe(0);
    expect(streak(["2026-08-31", "2026-08-31"], "2026-09-06")).toBe(1); // duplicates collapse
  });
});

describe("reviewStatus", () => {
  it("is due after seven days or when never reviewed", () => {
    expect(reviewStatus([], "2026-09-06")).toMatchObject({
      doneThisWeek: false,
      lastCompleted: null,
      daysSince: null,
      due: true,
      streak: 0,
      currentWeekStart: "2026-08-31",
    });
    expect(
      reviewStatus(
        [{ weekStart: "2026-08-24", completedAt: "2026-08-31" }],
        "2026-09-06",
      ),
    ).toMatchObject({ doneThisWeek: false, daysSince: 6, due: false });
    expect(
      reviewStatus(
        [{ weekStart: "2026-08-24", completedAt: "2026-08-30" }],
        "2026-09-06",
      ),
    ).toMatchObject({ daysSince: 7, due: true });
    expect(
      reviewStatus(
        [{ weekStart: "2026-08-31", completedAt: "2026-09-01" }],
        "2026-09-06",
      ),
    ).toMatchObject({ doneThisWeek: true, due: false, streak: 1 });
  });
  it("accepts completedAt with a time part", () => {
    expect(
      reviewStatus(
        [{ weekStart: "2026-08-31", completedAt: "2026-09-01T10:00:00.000Z" }],
        "2026-09-06",
      ).lastCompleted,
    ).toBe("2026-09-01");
  });
});

describe("staleness", () => {
  it("buckets days since import", () => {
    expect(staleness(null)).toBe("never");
    expect(staleness(0)).toBe("fresh");
    expect(staleness(7)).toBe("fresh");
    expect(staleness(8)).toBe("aging");
    expect(staleness(14)).toBe("aging");
    expect(staleness(15)).toBe("stale");
  });
});
