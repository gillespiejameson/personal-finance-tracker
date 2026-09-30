import { describe, expect, it } from "vitest";
import {
  STALE_BALANCE_DAYS,
  staleBanks,
  syncCaption,
} from "@/lib/simplefin/stale";
import type { LinkedAccount } from "@/lib/simplefin/types";

// Noon UTC keeps the local day the same in every US time zone.
const SYNCED = "2026-09-30T17:00:00.000Z";
const NOW = new Date("2026-09-30T18:00:00Z");

let nextId = 1;
const link = (over: Partial<LinkedAccount> = {}): LinkedAccount => ({
  id: nextId,
  sfinId: `ACT-${nextId++}`,
  orgName: "Test Bank",
  name: "Checking",
  currency: "USD",
  balanceCents: 10_000,
  balanceDate: "2026-09-29",
  accountId: 1,
  enabled: true,
  lastSyncedAt: SYNCED,
  ...over,
});

describe("staleBanks", () => {
  it("is empty before the first sync", () => {
    expect(staleBanks([link({ balanceDate: "2026-09-01" })], null)).toEqual([]);
  });

  it("flags a bank whose balance date is more than the threshold behind the last sync", () => {
    expect(STALE_BALANCE_DAYS).toBe(3);
    const accounts = [
      link({ orgName: "Fresh Bank", balanceDate: "2026-09-29" }),
      // Exactly at the threshold is still fine: weekends and bank cut-offs.
      link({ orgName: "Edge Bank", balanceDate: "2026-09-27" }),
      link({
        orgName: "Stuck Bank",
        name: "Everyday Checking",
        balanceDate: "2026-09-16",
      }),
    ];
    expect(staleBanks(accounts, SYNCED)).toEqual([
      {
        orgName: "Stuck Bank",
        lastUpdated: "2026-09-16",
        accounts: ["Everyday Checking"],
      },
    ]);
  });

  it("groups a bank's accounts and reports the newest date among them", () => {
    const accounts = [
      link({
        orgName: "Stuck Bank",
        name: "Checking",
        balanceDate: "2026-09-14",
      }),
      link({
        orgName: "Stuck Bank",
        name: "Savings",
        balanceDate: "2026-09-16",
      }),
      link({
        orgName: "Another Bank",
        name: "Card",
        balanceDate: "2026-09-10",
      }),
    ];
    expect(staleBanks(accounts, SYNCED)).toEqual([
      {
        orgName: "Another Bank",
        lastUpdated: "2026-09-10",
        accounts: ["Card"],
      },
      {
        orgName: "Stuck Bank",
        lastUpdated: "2026-09-16",
        accounts: ["Checking", "Savings"],
      },
    ]);
  });

  it("does not flag a bank while any of its accounts is still fresh", () => {
    const accounts = [
      link({
        orgName: "Mixed Bank",
        name: "Checking",
        balanceDate: "2026-09-29",
      }),
      link({
        orgName: "Mixed Bank",
        name: "Old CD",
        balanceDate: "2026-08-01",
      }),
    ];
    expect(staleBanks(accounts, SYNCED)).toEqual([]);
  });

  it("ignores accounts that are unmapped, disabled or have no balance date", () => {
    const accounts = [
      link({ accountId: null, balanceDate: "2026-09-01" }),
      link({ enabled: false, balanceDate: "2026-09-01" }),
      link({ balanceDate: null }),
    ];
    expect(staleBanks(accounts, SYNCED)).toEqual([]);
  });

  it("falls back to a generic name when SimpleFIN gives no organization", () => {
    expect(
      staleBanks([link({ orgName: null, balanceDate: "2026-09-01" })], SYNCED),
    ).toEqual([
      {
        orgName: "SimpleFIN",
        lastUpdated: "2026-09-01",
        accounts: ["Checking"],
      },
    ]);
  });
});

describe("syncCaption", () => {
  const base = {
    lastError: null,
    lastSyncAt: SYNCED,
    staleBanks: [],
    warnings: [],
  };

  it("says when it last synced when all is well", () => {
    expect(syncCaption(base, NOW)).toEqual({
      text: "Synced 1 hour ago",
      attention: false,
    });
  });

  it("says not synced yet before the first sync", () => {
    expect(syncCaption({ ...base, lastSyncAt: null }, NOW)).toEqual({
      text: "Not synced yet",
      attention: false,
    });
  });

  it("puts a failed sync first", () => {
    expect(
      syncCaption(
        {
          ...base,
          lastError: "SimpleFIN returned 503.",
          warnings: ["x"],
          staleBanks: [
            {
              orgName: "Stuck Bank",
              lastUpdated: "2026-09-16",
              accounts: ["A"],
            },
          ],
        },
        NOW,
      ),
    ).toEqual({
      text: "Sync needs attention — open Settings",
      attention: true,
    });
  });

  it("names a single stale bank and the day it last sent data", () => {
    expect(
      syncCaption(
        {
          ...base,
          warnings: ["x"],
          staleBanks: [
            {
              orgName: "Stuck Bank",
              lastUpdated: "2026-09-16",
              accounts: ["A"],
            },
          ],
        },
        NOW,
      ),
    ).toEqual({
      text: "Stuck Bank hasn't sent new data since Sep 16 — open Settings",
      attention: true,
    });
  });

  it("counts several stale banks", () => {
    expect(
      syncCaption(
        {
          ...base,
          staleBanks: [
            { orgName: "A Bank", lastUpdated: "2026-09-10", accounts: ["A"] },
            { orgName: "B Bank", lastUpdated: "2026-09-16", accounts: ["B"] },
          ],
        },
        NOW,
      ),
    ).toEqual({
      text: "2 banks haven't sent new data — open Settings",
      attention: true,
    });
  });

  it("points at warnings from the last sync", () => {
    expect(
      syncCaption(
        { ...base, warnings: ["Bank X needs re-authentication"] },
        NOW,
      ),
    ).toEqual({
      text: "Last sync had warnings — open Settings",
      attention: true,
    });
  });
});
