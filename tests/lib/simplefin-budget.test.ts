import { describe, expect, it } from "vitest";
import { localDay } from "@/lib/dates";
import {
  AUTO_MIN_MINUTES,
  bump,
  canSync,
  countToday,
  DAILY_CAP,
  EMPTY_STATE,
  NUDGE_HOURS,
} from "@/lib/simplefin/budget";

const NOW = new Date("2026-09-07T15:30:00Z");
/** The day the counter files NOW under, whatever zone the suite runs in. */
const TODAY = localDay(NOW);
const YESTERDAY = localDay(new Date(NOW.getTime() - 24 * 3600_000));
const manual = { automatic: false, lastAttemptAt: null, needed: 1 };

describe("budget", () => {
  it("constants", () => {
    expect(DAILY_CAP).toBe(20);
    expect(AUTO_MIN_MINUTES).toBe(30);
    expect(NUDGE_HOURS).toBe(6);
  });

  it("allows up to the cap and refuses the 21st request", () => {
    let state = EMPTY_STATE;
    for (let i = 0; i < 20; i++) {
      expect(canSync(state, NOW, manual)).toEqual({ ok: true });
      state = bump(state, NOW, 1);
    }
    expect(state).toEqual({ day: TODAY, count: 20 });
    expect(canSync(state, NOW, manual)).toEqual({
      ok: false,
      reason: "Daily SimpleFIN request limit reached (20); try again tomorrow.",
    });
  });

  it("refuses when the batch would cross the cap, not only at the cap", () => {
    expect(
      canSync({ day: TODAY, count: 19 }, NOW, { ...manual, needed: 2 }),
    ).toMatchObject({ ok: false });
    expect(
      canSync({ day: TODAY, count: 18 }, NOW, { ...manual, needed: 2 }),
    ).toEqual({ ok: true });
  });

  it("rolls the counter over at the local day boundary", () => {
    const state = { day: YESTERDAY, count: 20 };
    expect(countToday(state, NOW)).toBe(0);
    expect(canSync(state, NOW, manual)).toEqual({ ok: true });
    expect(bump(state, NOW, 3)).toEqual({ day: TODAY, count: 3 });
  });

  it("counts by the local day, so an evening and a morning sync share one", () => {
    // Two instants on one local day that fall on different UTC days west of
    // Greenwich; the budget must treat them as the same day either way.
    const evening = new Date(2026, 8, 7, 23, 0);
    const morning = new Date(2026, 8, 7, 1, 0);
    expect(bump(EMPTY_STATE, evening, 1)).toEqual({
      day: localDay(evening),
      count: 1,
    });
    expect(countToday(bump(EMPTY_STATE, morning, 2), evening)).toBe(2);
    expect(localDay(evening)).toBe(localDay(morning));
  });

  it("gates automatic syncs to 30 minutes after the last attempt, manual ones not", () => {
    const tenMinAgo = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    expect(
      canSync(EMPTY_STATE, NOW, {
        automatic: true,
        lastAttemptAt: tenMinAgo,
        needed: 1,
      }),
    ).toEqual({ ok: false, reason: "Synced less than 30 minutes ago." });
    expect(
      canSync(EMPTY_STATE, NOW, {
        automatic: false,
        lastAttemptAt: tenMinAgo,
        needed: 1,
      }),
    ).toEqual({ ok: true });
    const thirtyOneAgo = new Date(NOW.getTime() - 31 * 60_000).toISOString();
    expect(
      canSync(EMPTY_STATE, NOW, {
        automatic: true,
        lastAttemptAt: thirtyOneAgo,
        needed: 1,
      }),
    ).toEqual({ ok: true });
    expect(
      canSync(EMPTY_STATE, NOW, {
        automatic: true,
        lastAttemptAt: null,
        needed: 1,
      }),
    ).toEqual({ ok: true });
  });
});
