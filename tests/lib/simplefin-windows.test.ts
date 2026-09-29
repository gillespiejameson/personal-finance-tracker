import { describe, expect, it } from "vitest";
import {
  chunk,
  firstWindow,
  MAX_SPAN,
  MAX_WINDOW_DAYS,
  nextWindows,
  OVERLAP_DAYS,
  olderWindow,
  WINDOW_DAYS,
} from "@/lib/simplefin/windows";

const DAY = 86_400;
const NOW = new Date("2026-09-07T15:30:00Z");
const NOW_S = 1788795000; // 2026-09-07T15:30:00Z

const isMidnight = (s: number) =>
  new Date(s * 1000).toISOString().endsWith("T00:00:00.000Z");

describe("windows", () => {
  it("has the protocol's limits, kept an hour clear of the 90-day cap", () => {
    expect(MAX_WINDOW_DAYS).toBe(90);
    expect(OVERLAP_DAYS).toBe(5);
    expect(MAX_SPAN).toBe(MAX_WINDOW_DAYS * DAY - 3600);
    expect(WINDOW_DAYS).toBe(89);
    expect(Math.floor(NOW.getTime() / 1000)).toBe(NOW_S);
  });

  it("firstWindow starts at a UTC midnight and stays under the cap", () => {
    const w = firstWindow(NOW);
    expect(w).toEqual({ start: 1781049600, end: NOW_S });
    expect(new Date(w.start * 1000).toISOString()).toBe(
      "2026-06-10T00:00:00.000Z",
    );
    expect(w.end - w.start).toBeLessThanOrEqual(MAX_SPAN);
    // Still nearly the full 90 days of history.
    expect(w.end - w.start).toBeGreaterThan(89 * DAY);
  });

  it("nextWindows overlaps the last sync by five days, floored to midnight", () => {
    const lastSync = new Date(NOW.getTime() - 2 * DAY * 1000).toISOString();
    const w = nextWindows(lastSync, NOW);
    // 2026-09-07 15:30Z − 7 days = 2026-08-31 15:30Z, floored to that midnight.
    expect(w).toEqual([{ start: 1788134400, end: NOW_S }]);
    expect(isMidnight(w[0].start)).toBe(true);
  });

  it("nextWindows chunks a 100-day gap into two windows sharing a midnight", () => {
    const lastSync = new Date(NOW.getTime() - 100 * DAY * 1000).toISOString();
    const w = nextWindows(lastSync, NOW);
    expect(w).toEqual([
      { start: 1779667200, end: 1787356800 },
      { start: 1787356800, end: NOW_S },
    ]);
    // Covers everything from five days before the last sync to now.
    expect(w[0].start).toBeLessThanOrEqual(NOW_S - 105 * DAY);
    expect(w[w.length - 1].end).toBe(NOW_S);
    for (const x of w) {
      expect(isMidnight(x.start)).toBe(true);
      expect(x.end - x.start).toBeLessThanOrEqual(MAX_SPAN);
    }
  });

  it("nextWindows still fetches the overlap when the last sync is in the future", () => {
    const future = new Date(NOW.getTime() + 3600_000).toISOString();
    // 2026-09-07 15:30Z − 5 days = 2026-09-02 15:30Z, floored to that midnight.
    expect(nextWindows(future, NOW)).toEqual([
      { start: 1788307200, end: NOW_S },
    ]);
  });

  it("chunk floors the first start and never exceeds one window's span", () => {
    expect(chunk(0, 90 * DAY)).toEqual([
      { start: 0, end: 89 * DAY },
      { start: 89 * DAY, end: 90 * DAY },
    ]);
    expect(chunk(0, 89 * DAY)).toEqual([{ start: 0, end: 89 * DAY }]);
    expect(chunk(10, 10)).toEqual([]);
    // A mid-day start is pulled back to its midnight, not pushed forward.
    expect(chunk(DAY + 3600, DAY + 7200)).toEqual([
      { start: DAY, end: DAY + 7200 },
    ]);
  });

  it("olderWindow ends the day after its anchor and starts at a midnight", () => {
    // 2026-06-16T00:00Z = 1781568000; 89 days earlier = 2026-03-19T00:00Z.
    const w = olderWindow("2026-06-15");
    expect(w).toEqual({ start: 1773878400, end: 1781568000 });
    expect(new Date(w.start * 1000).toISOString()).toBe(
      "2026-03-19T00:00:00.000Z",
    );
    expect(w.end - w.start).toBeLessThanOrEqual(MAX_SPAN);
  });
});
