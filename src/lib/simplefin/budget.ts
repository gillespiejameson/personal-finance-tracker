import { localDay } from "@/lib/dates";

/** Requests allowed per local day; SimpleFIN allows about 24, this leaves headroom. */
export const DAILY_CAP = 20;
/** An automatic sync waits this long after the previous attempt. */
export const AUTO_MIN_MINUTES = 30;
/** How stale the last attempt must be before opening Home triggers a sync. */
export const NUDGE_HOURS = 6;

export type RequestState = { day: string; count: number };

export const EMPTY_STATE: RequestState = { day: "", count: 0 };

/** The counter rolls over with the user's day, not with UTC midnight. */
function dayOf(now: Date): string {
  return localDay(now);
}

/** Requests already made today; a state from another day counts as zero. */
export function countToday(state: RequestState, now: Date): number {
  return state.day === dayOf(now) ? state.count : 0;
}

/**
 * The automatic gate counts from the last *attempt*, not the last success:
 * a connection that fails every time must not be retried every page load.
 */
export function canSync(
  state: RequestState,
  now: Date,
  opts: { automatic: boolean; lastAttemptAt: string | null; needed: number },
): { ok: true } | { ok: false; reason: string } {
  if (countToday(state, now) + opts.needed > DAILY_CAP)
    return {
      ok: false,
      reason: `Daily SimpleFIN request limit reached (${DAILY_CAP}); try again tomorrow.`,
    };
  if (opts.automatic && opts.lastAttemptAt) {
    const since = now.getTime() - new Date(opts.lastAttemptAt).getTime();
    if (since < AUTO_MIN_MINUTES * 60_000)
      return {
        ok: false,
        reason: `Synced less than ${AUTO_MIN_MINUTES} minutes ago.`,
      };
  }
  return { ok: true };
}

export function bump(state: RequestState, now: Date, n = 1): RequestState {
  return { day: dayOf(now), count: countToday(state, now) + n };
}
