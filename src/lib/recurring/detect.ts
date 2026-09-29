import { addDays, daysBetween } from "@/lib/dates";

export type Cadence =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "annual";
export type Confidence = "confirmed" | "likely" | "manual";
export type Point = { date: string; amountCents: number };
export type Series = {
  merchant: string;
  categoryId: number | null;
  points: Point[];
};
export type Recurrence = {
  merchant: string;
  categoryId: number | null;
  cadence: Cadence;
  intervalDays: number;
  avgCents: number;
  /** Dollar-rounded cluster center; identifies the row across refreshes. */
  amountKey: number;
  toleranceCents: number;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  nextExpected: string;
  confidence: Exclude<Confidence, "manual">;
};
export type DetectOptions = {
  /** Amount spread (fraction of the cluster center) that still counts as one bill. */
  amountFraction?: number;
};

export const DEFAULT_AMOUNT_FRACTION = 0.15;
/** Fixed-category bills (utilities, insurance, phone) legitimately vary more. */
export const FIXED_AMOUNT_FRACTION = 0.35;
/** Below this the cluster tolerance is at least $5 rather than a fraction. */
const SMALL_AMOUNT_CENTS = 3000;
/** Two identical charges this large or larger, a month apart, are "likely". */
const LIKELY_MIN_CENTS = 1000;
/**
 * A cluster this share of the merchant's charges (or more) is "the bill": its
 * gaps may be bridged by the merchant's other charges at the cadence, and a
 * later charge at a different amount is the same bill re-priced. Smaller
 * clusters must be regular on their own dates, otherwise a weekly grocery
 * store's chance amount matches would read as a weekly bill.
 */
export const BRIDGE_MIN_SHARE = 0.7;
/**
 * A cluster below `BRIDGE_MIN_SHARE` needs this many collapsed points and
 * this share of the merchant's charges before it is a bill: three chance
 * same-dollar visits among a grocery store's twenty-two are not one.
 */
export const SMALL_CLUSTER_MIN_POINTS = 4;
export const SMALL_CLUSTER_MIN_SHARE = 0.25;
/**
 * Weekly is the cadence habits live in — a grocery run every Saturday sits in
 * the [5, 9]-day band for free — so a weekly cluster must be long enough to be
 * a pattern rather than a coincidence, and then either the merchant's majority
 * or steady in amount. A weekly habit at a delivery or retail merchant varies
 * week to week; a weekly payroll run is the same cents every time, so it is a
 * bill even as a minority of that merchant's charges.
 */
export const WEEKLY_MIN_POINTS = 6;
export const WEEKLY_MIN_SHARE = 0.5;
/** A weekly cluster is "steady" within $5, or 2% of its center above $250. */
export const WEEKLY_STEADY_CENTS = 500;
export const WEEKLY_STEADY_FRACTION = 0.02;

export const CADENCE_WINDOWS: Record<Cadence, [number, number]> = {
  weekly: [5, 9],
  biweekly: [11, 17],
  monthly: [26, 35],
  quarterly: [80, 100],
  annual: [350, 380],
};
const ORDER: Cadence[] = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annual",
];

/** The interval a manually declared bill of this cadence advances by. */
export function cadenceInterval(cadence: Cadence): number {
  const [lo, hi] = CADENCE_WINDOWS[cadence];
  return Math.floor((lo + hi) / 2);
}

export function amountKeyOf(cents: number): number {
  return Math.round(cents / 100) * 100;
}

export function amountTolerance(
  center: number,
  fraction = DEFAULT_AMOUNT_FRACTION,
): number {
  return Math.max(
    Math.abs(center) * fraction,
    Math.abs(center) < SMALL_AMOUNT_CENTS ? 500 : 0,
  );
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function monthlyize(cents: number, cadence: Cadence): number {
  const factor = {
    weekly: 52 / 12,
    biweekly: 26 / 12,
    monthly: 1,
    quarterly: 1 / 3,
    annual: 1 / 12,
  }[cadence];
  return Math.round(cents * factor);
}

function centerOf(cluster: Point[]): number {
  return median(cluster.map((p) => p.amountCents));
}

/**
 * Greedy amount clustering: walk the points by |amount| and add each to the
 * open cluster while it sits within `tolerance(center)` of the cluster's
 * running median, otherwise open a new one. Neighbouring clusters that are
 * one bill together (every point within `tolerance` of the merged center)
 * are merged, so a wide utility band does not split on where the running
 * median happened to sit; a looser rule would let a gas station's $30–60
 * fill-ups merge into one drifting "weekly bill". Largest cluster first.
 */
export function clusterAmounts(
  points: Point[],
  tolerance: (center: number) => number,
): Point[][] {
  const sorted = [...points].sort(
    (a, b) => Math.abs(a.amountCents) - Math.abs(b.amountCents),
  );
  const clusters: Point[][] = [];
  let current: Point[] = [];
  let center = 0;
  for (const p of sorted) {
    if (
      current.length > 0 &&
      Math.abs(p.amountCents - center) <= tolerance(center)
    ) {
      current.push(p);
    } else {
      if (current.length > 0) clusters.push(current);
      current = [p];
    }
    center = centerOf(current);
  }
  if (current.length > 0) clusters.push(current);
  const merged: Point[][] = [];
  for (const c of clusters) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const union = [...prev, ...c];
      const m = centerOf(union);
      const tol = tolerance(m);
      if (union.every((p) => Math.abs(p.amountCents - m) <= tol)) {
        merged[merged.length - 1] = union;
        continue;
      }
    }
    merged.push(c);
  }
  return merged.sort((a, b) => b.length - a.length);
}

/** Drop points within 5 days of the last kept one (same-day double charges). */
function collapse(points: Point[]): Point[] {
  const kept: Point[] = [];
  for (const p of points) {
    const last = kept[kept.length - 1];
    if (!last || daysBetween(last.date, p.date) >= 5) kept.push(p);
  }
  return kept;
}

/**
 * Whether the merchant's other charges fall inside the gap `a → b` at the
 * cadence, i.e. the bill was charged a different amount those months rather
 * than skipped.
 */
function bridged(
  a: string,
  b: string,
  others: string[],
  inWindow: (gap: number) => boolean,
): boolean {
  const between = others.filter((d) => d > a && d < b);
  if (between.length === 0) return false;
  const chain = [a, ...between, b];
  return chain.every(
    (d, i) => i === 0 || inWindow(daysBetween(chain[i - 1], d)),
  );
}

/**
 * A weekly cluster is a bill when it is long enough and then either the
 * merchant's majority or steady to within `WEEKLY_STEADY_CENTS` /
 * `WEEKLY_STEADY_FRACTION` of its own median amount.
 */
function weeklyQualifies(collapsed: Point[], share: number): boolean {
  if (collapsed.length < WEEKLY_MIN_POINTS) return false;
  if (share >= WEEKLY_MIN_SHARE) return true;
  const amounts = collapsed.map((p) => p.amountCents);
  const center = median(amounts);
  const band = Math.max(
    WEEKLY_STEADY_CENTS,
    Math.round(WEEKLY_STEADY_FRACTION * Math.abs(center)),
  );
  return amounts.every((a) => Math.abs(a - center) <= band);
}

/**
 * `otherDates` are the merchant's off-cluster charge dates (sorted), or empty
 * when the cluster is too small a share of them to speak for the merchant.
 * `share` is the cluster's fraction of the merchant's charges.
 */
function detectCluster(
  series: Series,
  cluster: Point[],
  otherDates: string[],
  share: number,
): Recurrence | null {
  const points = [...cluster].sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) return null;
  const collapsed = collapse(points);
  // Too many same-day duplicates: a daily or near-daily habit, not a bill.
  if ((points.length - collapsed.length) / points.length > 0.3) return null;
  if (collapsed.length < 2) return null;

  const gaps: number[] = [];
  for (let i = 1; i < collapsed.length; i++)
    gaps.push(daysBetween(collapsed[i - 1].date, collapsed[i].date));
  const medGap = median(gaps);
  const cadence = ORDER.find(
    (c) => medGap >= CADENCE_WINDOWS[c][0] && medGap <= CADENCE_WINDOWS[c][1],
  );
  if (!cadence) return null;
  const [lo, hi] = CADENCE_WINDOWS[cadence];
  if (cadence === "weekly" && !weeklyQualifies(collapsed, share)) return null;
  const inWindow = (g: number) => g >= lo && g <= hi;

  const amounts = collapsed.map((p) => p.amountCents);
  const firstSeen = collapsed[0].date;
  // Trailing edge: off-cluster charges that continue the cadence past the
  // cluster's last point are the bill charged a new amount, not a lapse.
  let lastSeen = collapsed[collapsed.length - 1].date;
  let trailing = 0;
  for (;;) {
    const next = otherDates.find(
      (d) => d > lastSeen && inWindow(daysBetween(lastSeen, d)),
    );
    if (!next) break;
    lastSeen = next;
    trailing++;
  }
  const base = {
    merchant: series.merchant,
    categoryId: series.categoryId,
    cadence,
    intervalDays: medGap,
    firstSeen,
    lastSeen,
    nextExpected: addDays(lastSeen, medGap),
  };

  if (collapsed.length < (cadence === "annual" ? 2 : 3)) {
    // Exactly two identical charges a month apart, and nothing else at the
    // merchant: likely a bill, not yet confirmed by a third. Two matching
    // amounts among many other charges are chance.
    const likely =
      collapsed.length === 2 &&
      share === 1 &&
      cadence === "monthly" &&
      amounts[0] === amounts[1] &&
      Math.abs(amounts[0]) >= LIKELY_MIN_CENTS;
    if (!likely) return null;
    return {
      ...base,
      avgCents: amounts[0],
      amountKey: amountKeyOf(amounts[0]),
      toleranceCents: 0,
      occurrences: 2 + trailing,
      confidence: "likely",
    };
  }
  // A minority cluster has to be more than a few chance matches: three of a
  // grocery store's twenty-two visits at the same dollar, or three of a gas
  // station's eight, sit on a cadence by accident often enough.
  if (
    cadence !== "annual" &&
    share < BRIDGE_MIN_SHARE &&
    (collapsed.length < SMALL_CLUSTER_MIN_POINTS ||
      share < SMALL_CLUSTER_MIN_SHARE)
  )
    return null;

  const regular = gaps.filter(
    (g, i) =>
      inWindow(g) ||
      bridged(collapsed[i].date, collapsed[i + 1].date, otherDates, inWindow),
  ).length;
  if (regular / gaps.length < 0.7) return null;

  const avgCents = median(amounts);
  return {
    ...base,
    avgCents,
    amountKey: amountKeyOf(avgCents),
    // Max deviation among this cluster's occurrences; other clusters do not widen it.
    toleranceCents: Math.max(...amounts.map((a) => Math.abs(a - avgCents))),
    occurrences: collapsed.length + trailing,
    confidence: "confirmed",
  };
}

/**
 * One recurrence per amount cluster that runs on a cadence, largest cluster
 * first. A merchant charged $15 and $60 monthly yields two; a payroll series
 * with a few stray small debits yields one.
 */
export function detectRecurring(
  series: Series,
  opts: DetectOptions = {},
): Recurrence[] {
  const fraction = opts.amountFraction ?? DEFAULT_AMOUNT_FRACTION;
  if (series.points.length < 2) return [];
  const clusters = clusterAmounts(series.points, (c) =>
    amountTolerance(c, fraction),
  );
  const found: Recurrence[] = [];
  for (const cluster of clusters) {
    const members = new Set(cluster);
    const share = cluster.length / series.points.length;
    const otherDates =
      share >= BRIDGE_MIN_SHARE
        ? series.points
            .filter((p) => !members.has(p))
            .map((p) => p.date)
            .sort()
        : [];
    const r = detectCluster(series, cluster, otherDates, share);
    if (r) found.push(r);
  }
  return found;
}
