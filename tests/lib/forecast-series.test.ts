import { describe, expect, it } from "vitest";
import { forecastSeries, startingCash, summarize } from "@/lib/forecast/series";
import type {
  ForecastEvent,
  ForecastPoint,
  SpendRate,
} from "@/lib/forecast/types";

const today = "2026-09-06";

const flatRate: SpendRate = {
  source: "average",
  thisMonthDailyCents: 2000,
  // Unused by the tests below (their horizons never leave today's month),
  // but kept internally consistent: 60000 / 30 = 2000/day.
  laterMonthlyCents: 60000,
};
const fixtureEvents: ForecastEvent[] = [
  { date: "2026-09-09", name: "Paycheck", amountCents: 100000, kind: "income" }, // day 3
  { date: "2026-09-11", name: "Rent", amountCents: -40000, kind: "bill" }, // day 5
];

describe("forecastSeries", () => {
  it("starts at today's balance with no events, then applies events before the daily rate each day", () => {
    const points = forecastSeries({
      startCents: 100000,
      today,
      days: 5,
      events: fixtureEvents,
      rate: flatRate,
    });
    // day1: 100000 - 2000 = 98000
    // day2: 98000 - 2000 = 96000
    // day3 (+100000 event): 96000 + 100000 - 2000 = 194000
    // day4: 194000 - 2000 = 192000
    // day5 (-40000 event): 192000 - 40000 - 2000 = 150000
    expect(points).toEqual([
      { date: "2026-09-06", balanceCents: 100000, events: [] },
      { date: "2026-09-07", balanceCents: 98000, events: [] },
      { date: "2026-09-08", balanceCents: 96000, events: [] },
      { date: "2026-09-09", balanceCents: 194000, events: [fixtureEvents[0]] },
      { date: "2026-09-10", balanceCents: 192000, events: [] },
      { date: "2026-09-11", balanceCents: 150000, events: [fixtureEvents[1]] },
    ]);
  });

  it("switches from the this-month rate to the later rate once the date crosses into the next month", () => {
    const points = forecastSeries({
      startCents: 50000,
      today: "2026-09-28",
      days: 5,
      events: [],
      rate: {
        source: "budget",
        thisMonthDailyCents: 1000,
        // October has 31 days; 93000 / 31 = 3000/day exactly.
        laterMonthlyCents: 93000,
      },
    });
    // 09-29, 09-30 are still September (rate 1000); 10-01..10-03 are October (rate 3000)
    // 50000 -1000 -1000 -3000 -3000 -3000 = 39000
    expect(points.map((p) => p.balanceCents)).toEqual([
      50000, 49000, 48000, 45000, 42000, 39000,
    ]);
    expect(points.map((p) => p.date)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("divides the later-month rate by that month's own day count rather than a flat 30", () => {
    const points = forecastSeries({
      startCents: 5000000,
      today: "2026-09-30",
      days: 32,
      events: [],
      rate: {
        source: "budget",
        thisMonthDailyCents: 0,
        laterMonthlyCents: 1230000,
      },
    });
    const byDate = new Map(points.map((p) => [p.date, p.balanceCents]));
    // October has 31 days: 1230000 / 31 = 39677.4... -> rounds to 39677/day.
    expect(
      (byDate.get("2026-10-01") ?? 0) - (byDate.get("2026-10-02") ?? 0),
    ).toBe(39677);
    // November has 30 days: 1230000 / 30 = 41000/day exactly.
    expect(
      (byDate.get("2026-10-31") ?? 0) - (byDate.get("2026-11-01") ?? 0),
    ).toBe(41000);
  });
});

describe("summarize", () => {
  const points = forecastSeries({
    startCents: 100000,
    today,
    days: 5,
    events: fixtureEvents,
    rate: flatRate,
  });
  // balances: 100000, 98000, 96000, 194000, 192000, 150000
  // lowest is day 2 (09-08) at 96000, sitting just before the paycheck lands.

  it("finds the lowest point and the ending balance", () => {
    const s = summarize(points, 0);
    expect(s.lowestCents).toBe(96000);
    expect(s.lowestDate).toBe("2026-09-08");
    expect(s.endCents).toBe(150000);
    expect(s.endDate).toBe("2026-09-11");
  });

  it("reports no floor breach when the floor sits at or below the lowest point", () => {
    const s = summarize(points, 95000);
    expect(s.belowFloorOn).toBeNull();
    expect(s.shortByCents).toBe(0);
  });

  it("reports the first date the balance dips below a higher floor", () => {
    const s = summarize(points, 97000);
    expect(s.belowFloorOn).toBe("2026-09-08");
    expect(s.shortByCents).toBe(1000); // 97000 - 96000
    // Here the first breach and the lowest point are the same day, so the
    // breach shortfall and the lowest-point shortfall happen to agree.
    expect(s.shortAtBreachCents).toBe(1000);
  });
});

describe("summarize — shortAtBreachCents", () => {
  // Hand-built points where the balance first dips below the floor, then
  // recovers above it, then dips to a deeper (but later) true minimum — so
  // the first-breach day and the lowest-point day diverge.
  const divergent: ForecastPoint[] = [
    { date: "2026-09-06", balanceCents: 100000, events: [] },
    { date: "2026-09-07", balanceCents: 80000, events: [] },
    { date: "2026-09-08", balanceCents: 95000, events: [] },
    { date: "2026-09-09", balanceCents: 60000, events: [] },
  ];

  it("measures the shortfall at the first breach date, separately from the lowest point", () => {
    const s = summarize(divergent, 85000);
    expect(s.belowFloorOn).toBe("2026-09-07");
    expect(s.shortAtBreachCents).toBe(5000); // 85000 - 80000
    expect(s.lowestDate).toBe("2026-09-09");
    expect(s.lowestCents).toBe(60000);
    expect(s.shortByCents).toBe(25000); // 85000 - 60000, from the lowest point
  });

  it("is zero when the balance never dips below the floor", () => {
    const s = summarize(divergent, 50000);
    expect(s.belowFloorOn).toBeNull();
    expect(s.shortAtBreachCents).toBe(0);
  });
});

describe("startingCash", () => {
  it("sums checking, savings and cash balances but ignores credit, loan and investment", () => {
    const balances = [
      { type: "checking", balanceCents: 250000 },
      { type: "savings", balanceCents: 500000 },
      { type: "cash", balanceCents: 10000 },
      { type: "credit", balanceCents: 75000 },
      { type: "loan", balanceCents: 1200000 },
      { type: "investment", balanceCents: 900000 },
    ];
    expect(startingCash(balances)).toBe(760000);
  });

  it("treats an account with no snapshot yet (null balance) as contributing nothing", () => {
    expect(startingCash([{ type: "checking", balanceCents: null }])).toBe(0);
  });

  it("returns zero for an empty list", () => {
    expect(startingCash([])).toBe(0);
  });
});
