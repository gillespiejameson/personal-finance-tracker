import type { Window } from "./types";

/** SimpleFIN caps one request's date range at 90 days. */
export const MAX_WINDOW_DAYS = 90;
/** Re-fetch the tail of the last sync so late-posting rows are not missed. */
export const OVERLAP_DAYS = 5;

const DAY = 86_400;

/**
 * The widest span a single request asks for: an hour short of the protocol's
 * 90 days, so a bridge that compares the range inclusively still answers.
 */
export const MAX_SPAN = MAX_WINDOW_DAYS * DAY - 3600;

/** Whole days per window; keeps every chunk boundary on a UTC midnight. */
export const WINDOW_DAYS = Math.floor(MAX_SPAN / DAY);

function seconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

/** The UTC midnight at or before `s`. */
function dayFloor(s: number): number {
  return Math.floor(s / DAY) * DAY;
}

/** The UTC midnight at or after `s`. */
function dayCeil(s: number): number {
  return Math.ceil(s / DAY) * DAY;
}

/** Unix seconds at UTC midnight of a `YYYY-MM-DD` date. */
function dayStart(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
}

/**
 * `[start, end)` in consecutive windows. Starts sit on UTC midnight and no
 * window is wider than `MAX_SPAN`, so the bridge never sees a range it could
 * call too long and a re-fetch always covers whole days.
 */
export function chunk(start: number, end: number): Window[] {
  if (start >= end) return [];
  const out: Window[] = [];
  let s = dayFloor(start);
  while (s < end) {
    const e = Math.min(s + WINDOW_DAYS * DAY, end);
    out.push({ start: s, end: e });
    s = e;
  }
  return out;
}

/** First sync: as close to 90 days back as one request may reach. */
export function firstWindow(now: Date): Window {
  const end = seconds(now);
  return { start: dayCeil(end - MAX_SPAN), end };
}

/** Later syncs: from five days before the last sync to now, in ≤ 90-day chunks. */
export function nextWindows(lastSyncAt: string, now: Date): Window[] {
  const end = seconds(now);
  const last = Math.floor(new Date(lastSyncAt).getTime() / 1000);
  // A last-sync stamp ahead of the clock still gets the full overlap.
  const anchor = Number.isFinite(last) ? Math.min(last, end) : end;
  return chunk(anchor - OVERLAP_DAYS * DAY, end);
}

/** "Load older history": the window ending on, and including, `anchorDate`. */
export function olderWindow(anchorDate: string): Window {
  const end = dayStart(anchorDate) + DAY;
  return { start: end - WINDOW_DAYS * DAY, end };
}
