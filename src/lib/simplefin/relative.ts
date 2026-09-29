/**
 * Relative wording for sync timestamps. Rendered on the server (the pages are
 * `force-dynamic`) so a client component never derives it from its own clock.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Whole hours since `iso`; a timestamp in the future counts as 0. */
export function hoursSince(iso: string, now: Date): number {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / HOUR);
}

const plural = (n: number, unit: string) =>
  `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** "just now", "12 minutes ago", "2 hours ago", "3 days ago". */
export function relativeSince(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "just now";
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), "minute");
  if (ms < DAY) return plural(Math.floor(ms / HOUR), "hour");
  return plural(Math.floor(ms / DAY), "day");
}
