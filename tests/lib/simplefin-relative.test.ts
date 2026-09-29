import { describe, expect, it } from "vitest";
import { hoursSince, relativeSince } from "@/lib/simplefin/relative";

const now = new Date("2026-09-07T12:00:00.000Z");

describe("hoursSince", () => {
  it("floors to whole hours", () => {
    expect(hoursSince("2026-09-07T11:59:00.000Z", now)).toBe(0);
    expect(hoursSince("2026-09-07T06:30:00.000Z", now)).toBe(5);
    expect(hoursSince("2026-09-06T12:00:00.000Z", now)).toBe(24);
  });
  it("treats a future stamp as zero", () => {
    expect(hoursSince("2026-09-07T18:00:00.000Z", now)).toBe(0);
  });
});

describe("relativeSince", () => {
  it("words the gap", () => {
    expect(relativeSince("2026-09-07T11:59:30.000Z", now)).toBe("just now");
    expect(relativeSince("2026-09-07T11:59:00.000Z", now)).toBe("1 minute ago");
    expect(relativeSince("2026-09-07T11:48:00.000Z", now)).toBe(
      "12 minutes ago",
    );
    expect(relativeSince("2026-09-07T10:00:00.000Z", now)).toBe("2 hours ago");
    expect(relativeSince("2026-09-04T12:00:00.000Z", now)).toBe("3 days ago");
  });
});
