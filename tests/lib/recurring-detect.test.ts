import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import {
  amountKeyOf,
  amountTolerance,
  cadenceInterval,
  clusterAmounts,
  detectRecurring,
  monthlyize,
  type Point,
  type Series,
} from "@/lib/recurring/detect";

const series = (
  merchant: string,
  start: string,
  gapDays: number[],
  amounts: number[],
): Series => {
  let d = start;
  const points = amounts.map((amountCents, i) => {
    if (i > 0) d = addDays(d, gapDays[(i - 1) % gapDays.length]);
    return { date: d, amountCents };
  });
  return { merchant, categoryId: 7, points };
};

/** Interleave several dated series into one merchant. */
const merge = (merchant: string, ...parts: Series[]): Series => ({
  merchant,
  categoryId: 7,
  points: parts
    .flatMap((p) => p.points)
    .sort((a, b) => a.date.localeCompare(b.date)),
});

/** Deterministic PRNG (mulberry32) so random-looking series are reproducible. */
const mulberry32 = (seed: number) => {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A year of weekly visits with amounts drawn from `pick`. */
const weeklyVisits = (
  merchant: string,
  pick: (i: number, rnd: () => number) => number,
  seed = 1,
): Series => {
  const rnd = mulberry32(seed);
  const points: Point[] = [];
  let d = "2025-09-01";
  for (let i = 0; i < 52; i++) {
    points.push({ date: d, amountCents: -pick(i, rnd) });
    d = addDays(d, 7);
  }
  return { merchant, categoryId: 7, points };
};

describe("clusterAmounts", () => {
  const pts = (...amounts: number[]): Point[] =>
    amounts.map((amountCents, i) => ({
      date: `2026-01-${i + 1}`,
      amountCents,
    }));
  it("splits amounts around running medians, largest cluster first", () => {
    const clusters = clusterAmounts(
      pts(-1000, -5000, -1050, -5200, -980),
      (c) => Math.abs(c) * 0.15,
    );
    expect(
      clusters.map((c) => c.map((p) => p.amountCents).sort((a, b) => a - b)),
    ).toEqual([
      [-1050, -1000, -980],
      [-5200, -5000],
    ]);
  });
  it("merges neighbouring clusters that are one bill together", () => {
    // Greedy clustering splits a wide band where its running median happened
    // to sit; the pieces merge when every point fits the merged center.
    const wide = pts(
      -10398,
      -9161,
      -7424,
      -7289,
      -7221,
      -7041,
      -7547,
      -9125,
      -10350,
      -12224,
      -10933,
      -11556,
    );
    expect(
      clusterAmounts(wide, (c) => amountTolerance(c, 0.35)).map(
        (c) => c.length,
      ),
    ).toEqual([12]);
    // ...but not clusters that would leave points outside the tolerance.
    expect(
      clusterAmounts(pts(-1000, -1000, -1000, -1500, -1500, -1500), () => 200)
        .map((c) => c.length)
        .sort(),
    ).toEqual([3, 3]);
  });
  it("keeps every point and returns singletons for isolated amounts", () => {
    const clusters = clusterAmounts(pts(-100, -100000), () => 500);
    expect(clusters).toHaveLength(2);
    expect(clusters.flat()).toHaveLength(2);
    expect(clusterAmounts([], () => 0)).toEqual([]);
  });
});

describe("detectRecurring", () => {
  it("monthly with jitter and small amount drift", () => {
    const found = detectRecurring(
      series(
        "Geico",
        "2026-06-12",
        [26, 28, 31],
        [-31257, -31257, -31700, -31257],
      ),
    );
    expect(found).toHaveLength(1);
    const r = found[0];
    expect(r).toMatchObject({
      cadence: "monthly",
      occurrences: 4,
      avgCents: -31257,
      amountKey: -31300,
      confidence: "confirmed",
      firstSeen: "2026-06-12",
    });
    expect(r.nextExpected).toBe(addDays(r.lastSeen, r.intervalDays));
    expect(r.intervalDays).toBeGreaterThanOrEqual(26);
    expect(r.intervalDays).toBeLessThanOrEqual(35);
  });
  it("biweekly cleaner", () => {
    expect(
      detectRecurring(
        series(
          "Cleaner",
          "2026-06-02",
          [14],
          [-23500, -23500, -23500, -23500, -23500, -23500],
        ),
      )[0]?.cadence,
    ).toBe("biweekly");
  });
  it("weekly", () => {
    expect(
      detectRecurring(
        series(
          "Lawn",
          "2026-06-01",
          [7, 7, 8, 6],
          [-5000, -5000, -5000, -5000, -5000, -5000],
        ),
      )[0]?.cadence,
    ).toBe("weekly");
  });
  it("a weekly cluster needs six points, even at share 1", () => {
    const lawn = (n: number) =>
      detectRecurring(
        series("Lawn", "2026-06-01", [7, 7, 8, 6], Array(n).fill(-5000)),
      );
    expect(lawn(5)).toEqual([]);
    expect(lawn(6)[0]?.cadence).toBe("weekly");
  });
  it("a weekly cluster with wandering amounts needs a majority of the merchant's charges", () => {
    // The delivery shape: seven visits 5-9 days apart whose amounts wander
    // across the cluster's full +/-15% band, among a run of $25 charges every
    // other day. The small run is too bunched to be a bill itself, so the only
    // question is the seven's share - the amounts are too loose to earn it.
    const wandering = [-6800, -7300, -7700, -8000, -8300, -8700, -9200];
    const withOthers = (others: number) =>
      merge(
        "Delivery",
        series("Delivery", "2026-06-06", [7, 5, 9, 6, 8, 7], wandering),
        series("Delivery", "2026-06-01", [2], Array(others).fill(-2500)),
      );
    // 7 of 24 charges (~29%): passes the small-cluster gate, still not a bill.
    expect(detectRecurring(withOthers(17))).toEqual([]);
    // 7 of 12 (~58%): a majority, so it is.
    const found = detectRecurring(withOthers(5));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      cadence: "weekly",
      avgCents: -8000,
      occurrences: 7,
    });
  });
  it("a weekly cluster steady to the cent is a bill without a majority", () => {
    // The household-payroll shape: eight charges exactly a week apart at the
    // same amount, among the merchant's other one-offs at several sizes. The
    // eight are a minority (8 of 18) but no habit is this steady.
    const payroll = merge(
      "Payroll Co",
      series("Payroll Co", "2026-06-05", [7], Array(8).fill(-98765)),
      series("Payroll Co", "2026-06-09", [17], Array(4).fill(-4817)),
      series("Payroll Co", "2026-06-12", [23], [-187654, -190654]),
      series("Payroll Co", "2026-06-20", [26], [-3500, -3500]),
      series("Payroll Co", "2026-07-03", [41], [-156789, -14321]),
    );
    expect(payroll.points).toHaveLength(18);
    const found = detectRecurring(payroll);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      cadence: "weekly",
      avgCents: -98765,
      occurrences: 8,
      confidence: "confirmed",
    });
  });
  it("annual with two points", () => {
    const [r] = detectRecurring(
      series("Domain", "2025-06-01", [365], [-1500, -1500]),
    );
    expect(r).toMatchObject({ cadence: "annual", confidence: "confirmed" });
  });
  it("rejects daily coffee, too few points, irregular gaps, and alternating amounts", () => {
    expect(
      detectRecurring(
        series(
          "Coffee",
          "2026-06-01",
          [1, 2, 1, 1],
          [-450, -450, -450, -450, -450],
        ),
      ),
    ).toEqual([]);
    // Two charges of different amounts are not a bill (identical ones are
    // "likely", tested below).
    expect(
      detectRecurring(series("Once", "2026-06-01", [30], [-1000, -1200])),
    ).toEqual([]);
    expect(
      detectRecurring(series("Single", "2026-06-01", [], [-1000])),
    ).toEqual([]);
    expect(
      detectRecurring(
        series(
          "Random",
          "2026-06-01",
          [3, 40, 12, 90],
          [-1000, -1000, -1000, -1000, -1000],
        ),
      ),
    ).toEqual([]);
    // $10 and $50 alternate every 30 days: each cluster is on a 60-day
    // cadence, which is nothing.
    expect(
      detectRecurring(
        series(
          "TwoClusters",
          "2026-06-01",
          [30],
          [-1000, -5000, -1000, -5000, -1000, -5000],
        ),
      ),
    ).toEqual([]);
  });
  it("tolerates a 30% amount outlier and small amounts within $5", () => {
    // The outlier month keeps the cluster's cadence intact: an off-cluster
    // charge bridges the gap it leaves.
    const found = detectRecurring(
      series(
        "Power",
        "2026-06-05",
        [30],
        [-12000, -12500, -15900, -11800, -12200],
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ cadence: "monthly", occurrences: 4 });
    expect(found[0].toleranceCents).toBeGreaterThan(0);
    expect(
      detectRecurring(
        series("Cloud", "2026-06-05", [30], [-299, -599, -499, -399]),
      )[0]?.cadence,
    ).toBe("monthly");
  });
  it("does not let bridging accept a genuinely skipped month", () => {
    expect(
      detectRecurring(
        series(
          "Skipped",
          "2026-06-01",
          [30, 60, 30],
          [-1000, -1000, -1000, -1000],
        ),
      ),
    ).toEqual([]);
  });
  it("tolerates a same-day double charge but still rejects daily habits", () => {
    const [r] = detectRecurring(
      series(
        "Doubled",
        "2026-06-01",
        [0, 30, 30, 30],
        [-1000, -1000, -1000, -1000, -1000],
      ),
    );
    expect(r).toMatchObject({ cadence: "monthly", occurrences: 4 });
    expect(
      detectRecurring(
        series(
          "Coffee",
          "2026-06-01",
          [1, 2, 1, 1, 3, 2, 1],
          [-450, -450, -450, -450, -450, -450, -450, -450],
        ),
      ),
    ).toEqual([]);
  });
  it("tolerance describes the matched cluster only", () => {
    const found = detectRecurring(
      series(
        "Outlier",
        "2026-06-01",
        [30],
        [-1000, -1000, -3000, -1000, -1000],
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ avgCents: -1000, toleranceCents: 0 });
  });
  it("payroll-shaped series: the weekly cluster is found, the scattered small charges are not", () => {
    const s = merge(
      "Acme Payroll",
      series("Acme Payroll", "2026-06-05", [7], Array(8).fill(-98765)),
      series("Acme Payroll", "2026-06-09", [17], [-4817, -4817]),
      series("Acme Payroll", "2026-07-02", [], [-3500]),
    );
    const found = detectRecurring(s);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      cadence: "weekly",
      avgCents: -98765,
      amountKey: -98800,
      occurrences: 8,
      confidence: "confirmed",
    });
  });
  it("a weekly grocery store is not a weekly bill", () => {
    // A run of six similar-sized shops followed by three more months apart:
    // with gap bridging open to every cluster, the merchant's other weekly
    // visits would fill the gaps and the nine would read as a weekly bill.
    // The cluster is a small share of the visits, so its own dates must be
    // regular, and they are not.
    const runWeeks = new Set([3, 4, 5, 6, 7, 8, 18, 30, 44]);
    let k = 0;
    const planted = weeklyVisits(
      "Grocer",
      (i, rnd) => {
        if (runWeeks.has(i)) return 9200 + ((k++ * 430) % 1600);
        // Everything else is spread over $40–85 and $115–150.
        const u = rnd();
        return u < 0.5
          ? 4000 + Math.round(u * 2 * 4500)
          : 11500 + Math.round((u - 0.5) * 2 * 3500);
      },
      7,
    );
    expect(detectRecurring(planted)).toEqual([]);
    // Twenty random years of $40–150 shops: none is a bill.
    for (let seed = 1; seed <= 20; seed++)
      expect(
        detectRecurring(
          weeklyVisits(
            "Grocer",
            (_, rnd) => 4000 + Math.round(rnd() * 11000),
            seed,
          ),
        ),
      ).toEqual([]);
  });
  it("a small cluster's gaps are not bridged by the merchant's other charges", () => {
    // $10 in four of eight months; the other four months are $30. Neither
    // cluster is 70% of the charges, and each on its own runs every 60 days.
    expect(
      detectRecurring(
        series(
          "Split",
          "2026-01-05",
          [30],
          [-1000, -3000, -1000, -3000, -1000, -3000, -1000, -3000],
        ),
      ),
    ).toEqual([]);
  });
  it("a few same-dollar visits among a merchant's many are not a bill", () => {
    // Shapes seen on real data: a grocery chain with 3 of 22 charges at $48
    // a month apart, a gas station with 3 of 8 at $21 every two weeks, and a
    // POS aggregate with 3 of 14 at $26 weekly. Each small cluster is on a
    // cadence, and each is chance.
    const grocery = merge(
      "Grocer",
      series("Grocer", "2026-01-06", [30], [-4800, -4800, -4800]),
      series(
        "Grocer",
        "2026-01-02",
        [7],
        [
          -6100, -7250, -9900, -8300, -12000, -6600, -14100, -7800, -9100,
          -10500, -6900, -13200, -8800, -7100, -11400, -9600, -6200, -12700,
          -8000,
        ],
      ),
    );
    expect(grocery.points).toHaveLength(22);
    expect(detectRecurring(grocery)).toEqual([]);
    const gas = merge(
      "Gas",
      series("Gas", "2026-03-02", [14], [-2100, -2100, -2100]),
      series("Gas", "2026-03-06", [9], [-3400, -5200, -4100, -5900, -3700]),
    );
    expect(gas.points).toHaveLength(8);
    expect(detectRecurring(gas)).toEqual([]);
    const pos = merge(
      "POS",
      series("POS", "2026-04-01", [7], [-2600, -2600, -2600]),
      series(
        "POS",
        "2026-04-03",
        [5],
        [
          -4200, -6800, -5100, -9300, -4600, -7700, -5500, -8100, -6300, -4900,
          -7200,
        ],
      ),
    );
    expect(pos.points).toHaveLength(14);
    expect(detectRecurring(pos)).toEqual([]);
    // A minority cluster with four points and a quarter of the charges is a
    // bill when its own dates are regular: four same-dollar biweekly charges
    // among twelve.
    const four = merge(
      "Sitter",
      series("Sitter", "2026-05-04", [14], [-5000, -5000, -5000, -5000]),
      series(
        "Sitter",
        "2026-05-07",
        [8],
        [-7200, -9800, -12500, -8100, -14000, -7600, -11100, -9300],
      ),
    );
    expect(four.points).toHaveLength(12);
    const found = detectRecurring(four);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      cadence: "biweekly",
      avgCents: -5000,
      occurrences: 4,
      confidence: "confirmed",
    });
    // The weekly payroll shape (8 of 11 weekly) is a majority cluster and
    // keeps the three-point rule.
    const sitter = merge(
      "Sitter",
      series("Sitter", "2026-06-05", [7], Array(8).fill(-60000)),
      series("Sitter", "2026-06-09", [17], [-4817, -4817, -3500]),
    );
    expect(sitter.points).toHaveLength(11);
    expect(detectRecurring(sitter)).toHaveLength(1);
  });
  it("two identical charges among a merchant's other charges are not likely", () => {
    const pair = merge(
      "Shop",
      series("Shop", "2026-07-03", [31], [-2500, -2500]),
      series("Shop", "2026-07-10", [9], [-4100, -6800, -5300, -9000]),
    );
    expect(pair.points).toHaveLength(6);
    expect(detectRecurring(pair)).toEqual([]);
  });
  it("a bill re-priced after its last cluster point is still current", () => {
    // $100 for five months, then $145: the row's last occurrence is the
    // $145 charge rather than the last $100, so it is neither overdue nor
    // forecast twice; the average stays the cluster's.
    const found = detectRecurring(
      series(
        "City Power",
        "2026-03-10",
        [30],
        [-10000, -10000, -10000, -10000, -10000, -14500],
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      cadence: "monthly",
      avgCents: -10000,
      amountKey: -10000,
      occurrences: 6,
      firstSeen: "2026-03-10",
      lastSeen: "2026-08-07",
      nextExpected: "2026-09-06",
      confidence: "confirmed",
    });
    // A later charge outside the cadence window does not extend it.
    const lapsed = detectRecurring(
      series(
        "City Power",
        "2026-03-10",
        [30, 30, 30, 30, 75],
        [-10000, -10000, -10000, -10000, -10000, -14500],
      ),
    );
    expect(lapsed[0]).toMatchObject({
      occurrences: 5,
      lastSeen: "2026-07-08",
    });
  });
  it("a wide utility band is one bill even where greedy clustering split it", () => {
    const wide = series(
      "City Power",
      "2025-09-10",
      [30],
      [
        -10398, -9161, -7424, -7289, -7221, -7041, -7547, -9125, -10350, -12224,
        -10933, -11556,
      ],
    );
    const found = detectRecurring(wide, { amountFraction: 0.35 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ cadence: "monthly", occurrences: 12 });
    const even = series(
      "City Power",
      "2026-01-10",
      [30],
      Array.from({ length: 12 }, (_, i) => -Math.round(7000 + (i * 6000) / 11)),
    );
    expect(detectRecurring(even, { amountFraction: 0.35 })).toHaveLength(1);
  });
  it("amountFraction widens the cluster for bills that legitimately vary", () => {
    const utility = series(
      "City Power",
      "2026-03-10",
      [30],
      [-10000, -11500, -8500, -12800, -9600, -10400],
    );
    expect(detectRecurring(utility)).toEqual([]);
    expect(detectRecurring(utility, { amountFraction: 0.15 })).toEqual([]);
    const found = detectRecurring(utility, { amountFraction: 0.35 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      cadence: "monthly",
      occurrences: 6,
      confidence: "confirmed",
    });
  });
  it("two identical monthly charges are likely; different, small or off-cadence pairs are nothing", () => {
    const [likely] = detectRecurring(
      series("Gym", "2026-07-03", [31], [-2500, -2500]),
    );
    expect(likely).toMatchObject({
      cadence: "monthly",
      confidence: "likely",
      occurrences: 2,
      avgCents: -2500,
      amountKey: -2500,
      intervalDays: 31,
      toleranceCents: 0,
      firstSeen: "2026-07-03",
      lastSeen: "2026-08-03",
      nextExpected: "2026-09-03",
    });
    expect(
      detectRecurring(series("Gym", "2026-07-03", [31], [-2500, -2600])),
    ).toEqual([]);
    expect(
      detectRecurring(series("Snack", "2026-07-03", [31], [-900, -900])),
    ).toEqual([]);
    expect(
      detectRecurring(series("Gym", "2026-07-03", [14], [-2500, -2500])),
    ).toEqual([]);
    // Exactly two: a third identical charge is a confirmed bill instead.
    expect(
      detectRecurring(
        series("Gym", "2026-07-03", [31], [-2500, -2500, -2500]),
      )[0]?.confidence,
    ).toBe("confirmed");
  });
  it("a merchant with two genuine clusters yields two recurrences", () => {
    const s = merge(
      "Amazon",
      series("Amazon", "2026-05-01", [30], [-1500, -1500, -1500, -1500]),
      series("Amazon", "2026-05-15", [30], [-6000, -6000, -6000, -6000]),
    );
    const found = detectRecurring(s);
    expect(found).toHaveLength(2);
    expect(found.map((r) => r.amountKey).sort((a, b) => a - b)).toEqual([
      -6000, -1500,
    ]);
    expect(found.every((r) => r.cadence === "monthly")).toBe(true);
    expect(found.every((r) => r.occurrences === 4)).toBe(true);
  });
  it("amountKeyOf rounds to the dollar; cadenceInterval is the window midpoint", () => {
    expect(amountKeyOf(-31257)).toBe(-31300);
    expect(amountKeyOf(-31249)).toBe(-31200);
    expect(amountKeyOf(1049)).toBe(1000);
    expect(cadenceInterval("weekly")).toBe(7);
    expect(cadenceInterval("biweekly")).toBe(14);
    expect(cadenceInterval("monthly")).toBe(30);
    expect(cadenceInterval("quarterly")).toBe(90);
    expect(cadenceInterval("annual")).toBe(365);
  });
  it("monthlyize", () => {
    expect(monthlyize(-1000, "weekly")).toBe(-4333);
    expect(monthlyize(-1000, "biweekly")).toBe(-2167);
    expect(monthlyize(-1000, "monthly")).toBe(-1000);
    expect(monthlyize(-3000, "quarterly")).toBe(-1000);
    expect(monthlyize(-12000, "annual")).toBe(-1000);
  });
});
