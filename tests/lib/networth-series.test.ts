import { describe, expect, it } from "vitest";
import {
  type AccountSnapshot,
  deltaAvailable,
  latestBalances,
  netWorthAt,
  netWorthSeries,
} from "@/lib/networth/series";

const accounts = [
  { id: 1, isLiability: false }, // A: asset
  { id: 2, isLiability: true }, // C: credit
];

const snapshots: AccountSnapshot[] = [
  { accountId: 1, date: "2026-07-15", balanceCents: 100000 },
  { accountId: 1, date: "2026-08-20", balanceCents: 120000 },
  { accountId: 2, date: "2026-08-05", balanceCents: 30000 },
];

const today = "2026-09-06";

describe("netWorthSeries", () => {
  it("builds month-end points from the first snapshot's month through today, carrying forward", () => {
    expect(netWorthSeries(snapshots, accounts, today)).toEqual([
      {
        date: "2026-07-31",
        netWorthCents: 100000,
        assetsCents: 100000,
        liabilitiesCents: 0,
      },
      {
        date: "2026-08-31",
        netWorthCents: 90000,
        assetsCents: 120000,
        liabilitiesCents: 30000,
      },
      {
        date: "2026-09-06",
        netWorthCents: 90000,
        assetsCents: 120000,
        liabilitiesCents: 30000,
      },
    ]);
  });

  it("returns an empty series when there are no snapshots", () => {
    expect(netWorthSeries([], accounts, today)).toEqual([]);
  });

  it("returns an empty series when the only snapshot is future-dated", () => {
    const futureOnly: AccountSnapshot[] = [
      { accountId: 1, date: "2026-12-01", balanceCents: 500000 },
    ];
    expect(netWorthSeries(futureOnly, accounts, today)).toEqual([]);
  });
});

describe("latestBalances", () => {
  it("ignores a snapshot dated after today", () => {
    const withFuture: AccountSnapshot[] = [
      ...snapshots,
      { accountId: 1, date: "2026-09-10", balanceCents: 999999 },
    ];
    const balances = latestBalances(withFuture, today);
    expect(balances.get(1)).toEqual({
      date: "2026-08-20",
      balanceCents: 120000,
    });
  });
});

describe("netWorthAt", () => {
  it("is 0 with no snapshots yet", () => {
    expect(netWorthAt([], accounts, "2026-07-01")).toEqual({
      netWorthCents: 0,
      assetsCents: 0,
      liabilitiesCents: 0,
    });
  });
});

describe("deltaAvailable", () => {
  const cutoff = "2026-08-07"; // today (2026-09-06) minus 30 days

  it("is false when an account's first snapshot is after the cutoff", () => {
    const snaps: AccountSnapshot[] = [
      { accountId: 1, date: "2026-07-01", balanceCents: 100000 },
      { accountId: 2, date: "2026-08-20", balanceCents: 30000 }, // after cutoff only
    ];
    expect(deltaAvailable(snaps, accounts, today, cutoff)).toBe(false);
  });

  it("is true when both accounts are present at both dates", () => {
    const snaps: AccountSnapshot[] = [
      { accountId: 1, date: "2026-07-01", balanceCents: 100000 },
      { accountId: 1, date: "2026-08-20", balanceCents: 120000 },
      { accountId: 2, date: "2026-07-15", balanceCents: 30000 },
    ];
    expect(deltaAvailable(snaps, accounts, today, cutoff)).toBe(true);
  });
});
