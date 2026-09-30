import { describe, expect, it } from "vitest";
import { deleteAccountIfEmpty } from "@/lib/accounts/delete";
import { ensureDefaultCategories } from "@/lib/categories/ensure";
import { localDay } from "@/lib/dates";
import { openDb } from "@/lib/db/client";
import { accounts, simplefinAccounts, transactions } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import {
  bumpRequests,
  clearConnection,
  earliestSyncedDate,
  getAccessUrl,
  getConnection,
  getHistoryFloor,
  getLastAttemptAt,
  getLastError,
  getRequestState,
  hasUnsyncedMappedAccount,
  KEYS,
  listLinkedAccounts,
  mapAccount,
  markAccountSynced,
  setAccessUrl,
  setAuto,
  setEnabled,
  setHistoryFloor,
  setLastAttemptAt,
  setLastError,
  setLastSyncAt,
  setLastWarnings,
  upsertLinkedAccounts,
} from "@/lib/simplefin/store";
import type { SfinAccount } from "@/lib/simplefin/types";
import { mustFind } from "../helpers";

const NOW = new Date("2026-09-07T15:30:00Z");
const ACCESS = "https://u:p@sfin.test/simplefin";

/** A balance date is an instant; the day it is filed under is the local one. */
const dayOfSeconds = (seconds: number) => localDay(new Date(seconds * 1000));

const sfin = (over: Partial<SfinAccount> = {}): SfinAccount => ({
  id: "ACT-1",
  org: { domain: "bank.test", name: "Test Bank" },
  name: "Checking",
  currency: "USD",
  balance: "1234.56",
  "balance-date": 1788566400, // 2026-09-05T00:00:00Z
  ...over,
});

function seed() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  const [chk] = db
    .insert(accounts)
    .values({ name: "Chk", type: "checking" })
    .returning()
    .all();
  return { db, chk };
}

describe("simplefin store", () => {
  it("starts disconnected with sensible defaults", () => {
    const { db } = seed();
    expect(getConnection(db, NOW)).toEqual({
      connected: false,
      connectedAt: null,
      lastSyncAt: null,
      lastAttemptAt: null,
      lastError: null,
      auto: true,
      maskedUrl: null,
      requestsToday: 0,
      accounts: [],
      earliestSynced: null,
      warnings: [],
      staleBanks: [],
      // Nothing to sync while disconnected, however stale it looks.
      shouldAutoSync: false,
    });
  });

  it("stores the access URL, masks it in the connection, and forgets it on disconnect", () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    setLastSyncAt(db, "2026-09-07T16:00:00Z");
    setAuto(db, false);
    expect(getAccessUrl(db)).toBe(ACCESS);
    const c = getConnection(db, NOW);
    expect(c).toMatchObject({
      connected: true,
      connectedAt: "2026-09-07T15:30:00.000Z",
      lastSyncAt: "2026-09-07T16:00:00Z",
      auto: false,
      maskedUrl: "https://…@sfin.test/simplefin",
    });
    expect(JSON.stringify(c)).not.toContain("u:p");

    setLastAttemptAt(db, "2026-09-07T16:00:00Z");
    setLastError(db, "SimpleFIN subscription needs attention.");
    setHistoryFloor(db, "2026-03-19");
    upsertLinkedAccounts(db, [sfin()]);
    clearConnection(db);
    expect(getAccessUrl(db)).toBeNull();
    expect(getLastAttemptAt(db)).toBeNull();
    expect(getLastError(db)).toBeNull();
    expect(getHistoryFloor(db)).toBeNull();
    expect(getSetting(db, KEYS.accessUrl, "gone")).toBe("gone");
    expect(getConnection(db, NOW)).toMatchObject({
      connected: false,
      connectedAt: null,
      lastSyncAt: null,
      auto: false, // the preference survives
    });
    // Linked accounts stay listed but disabled.
    expect(listLinkedAccounts(db)).toHaveLength(1);
    expect(listLinkedAccounts(db)[0].enabled).toBe(false);
  });

  it("reconnecting clears the last sync so the next sync starts fresh", () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    setLastSyncAt(db, "2026-09-07T16:00:00Z");
    setLastAttemptAt(db, "2026-09-07T16:00:00Z");
    setLastError(db, "SimpleFIN rejected the connection");
    setHistoryFloor(db, "2026-03-19");
    setLastWarnings(db, ["Bank X needs re-authentication"]);
    setAccessUrl(db, "https://x:y@sfin.test/simplefin", NOW);
    expect(getConnection(db, NOW)).toMatchObject({
      lastSyncAt: null,
      lastAttemptAt: null,
      lastError: null,
      warnings: [],
    });
    expect(getHistoryFloor(db)).toBeNull();
  });

  it("remembers the last attempt and the last error, clearing the error on success", () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    expect(getLastAttemptAt(db)).toBeNull();
    expect(getLastError(db)).toBeNull();
    setLastAttemptAt(db, "2026-09-07T15:00:00Z");
    setLastError(db, "Couldn't reach SimpleFIN.");
    expect(getConnection(db, NOW)).toMatchObject({
      lastAttemptAt: "2026-09-07T15:00:00Z",
      lastError: "Couldn't reach SimpleFIN.",
      // A failed attempt still counts as an attempt: no retry for six hours.
      shouldAutoSync: false,
    });
    setLastError(db, null);
    expect(getLastError(db)).toBeNull();
    expect(getConnection(db, NOW).lastError).toBeNull();
  });

  it("shouldAutoSync wants a connection, the preference, staleness and budget", () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    // Never attempted: sync on the first Home load.
    expect(getConnection(db, NOW).shouldAutoSync).toBe(true);

    setLastAttemptAt(db, new Date(NOW.getTime() - 5 * 3600_000).toISOString());
    expect(getConnection(db, NOW).shouldAutoSync).toBe(false);
    setLastAttemptAt(db, new Date(NOW.getTime() - 6 * 3600_000).toISOString());
    expect(getConnection(db, NOW).shouldAutoSync).toBe(true);

    setAuto(db, false);
    expect(getConnection(db, NOW).shouldAutoSync).toBe(false);
    setAuto(db, true);

    // The daily cap is decided on the server too, so the nudge never fires
    // into a refusal.
    bumpRequests(db, NOW, 20);
    expect(getConnection(db, NOW)).toMatchObject({
      requestsToday: 20,
      shouldAutoSync: false,
    });
    expect(getConnection(db, new Date("2026-09-08T15:30:00Z"))).toMatchObject({
      requestsToday: 0,
      shouldAutoSync: true,
    });
  });

  it("the history floor is the earliest window already asked for", () => {
    const { db } = seed();
    expect(getHistoryFloor(db)).toBeNull();
    setHistoryFloor(db, "2026-06-10");
    expect(getHistoryFloor(db)).toBe("2026-06-10");
    setHistoryFloor(db, "2026-03-13");
    expect(getHistoryFloor(db)).toBe("2026-03-13");
  });

  it("counts requests per local day", () => {
    const { db } = seed();
    expect(getRequestState(db)).toEqual({ day: "", count: 0 });
    bumpRequests(db, NOW, 2);
    expect(bumpRequests(db, NOW)).toEqual({ day: localDay(NOW), count: 3 });
    expect(getConnection(db, NOW).requestsToday).toBe(3);
    const tomorrow = new Date(NOW.getTime() + 24 * 3600_000);
    expect(getConnection(db, tomorrow).requestsToday).toBe(0);
    expect(bumpRequests(db, tomorrow)).toEqual({
      day: localDay(tomorrow),
      count: 1,
    });
  });

  it("upserts linked accounts, refreshing facts but keeping mapping and enabled", () => {
    const { db, chk } = seed();
    upsertLinkedAccounts(db, [
      sfin(),
      sfin({ id: "ACT-2", name: "Card", org: { name: "  " }, balance: "-50" }),
    ]);
    let list = listLinkedAccounts(db);
    expect(list).toHaveLength(2);
    expect(mustFind(list, (l) => l.sfinId === "ACT-1", "ACT-1")).toMatchObject({
      orgName: "Test Bank",
      name: "Checking",
      currency: "USD",
      balanceCents: 123456,
      balanceDate: dayOfSeconds(1788566400),
      accountId: null,
      enabled: true,
      lastSyncedAt: null,
    });
    expect(mustFind(list, (l) => l.sfinId === "ACT-2", "ACT-2")).toMatchObject({
      orgName: null,
      balanceCents: -5000,
    });

    expect(mapAccount(db, "ACT-1", chk.id)).toEqual({ ok: true });
    setEnabled(db, "ACT-2", false);
    upsertLinkedAccounts(db, [
      sfin({
        name: "Everyday Checking",
        balance: "1000",
        "balance-date": 1788652800,
      }),
      sfin({ id: "ACT-2", name: "Card", balance: "bad", "balance-date": 0 }),
    ]);
    list = listLinkedAccounts(db);
    expect(mustFind(list, (l) => l.sfinId === "ACT-1", "ACT-1")).toMatchObject({
      name: "Everyday Checking",
      balanceCents: 100000,
      balanceDate: dayOfSeconds(1788652800),
      accountId: chk.id,
      enabled: true,
    });
    expect(mustFind(list, (l) => l.sfinId === "ACT-2", "ACT-2")).toMatchObject({
      balanceCents: null,
      balanceDate: null,
      enabled: false,
    });
  });

  it("hasUnsyncedMappedAccount is true only for a mapped, enabled, never-synced link", () => {
    const { db, chk } = seed();
    expect(hasUnsyncedMappedAccount(db)).toBe(false);

    upsertLinkedAccounts(db, [sfin()]);
    // Listed but not mapped to an app account: nothing to fetch history for.
    expect(hasUnsyncedMappedAccount(db)).toBe(false);

    expect(mapAccount(db, "ACT-1", chk.id)).toEqual({ ok: true });
    expect(hasUnsyncedMappedAccount(db)).toBe(true);

    markAccountSynced(db, "ACT-1", NOW.toISOString());
    expect(hasUnsyncedMappedAccount(db)).toBe(false);

    // A mapped link that has never synced but is switched off stays out.
    upsertLinkedAccounts(db, [sfin({ id: "ACT-2", name: "Card" })]);
    const [other] = db
      .insert(accounts)
      .values({ name: "Savings", type: "savings" })
      .returning()
      .all();
    expect(mapAccount(db, "ACT-2", other.id)).toEqual({ ok: true });
    expect(hasUnsyncedMappedAccount(db)).toBe(true);
    setEnabled(db, "ACT-2", false);
    expect(hasUnsyncedMappedAccount(db)).toBe(false);
  });

  it("mapAccount validates the target and refuses non-USD or double mapping", () => {
    const { db, chk } = seed();
    upsertLinkedAccounts(db, [
      sfin(),
      sfin({ id: "ACT-2", name: "Euro", currency: "EUR" }),
      sfin({ id: "ACT-3", name: "Other" }),
    ]);
    expect(mapAccount(db, "nope", chk.id)).toEqual({
      ok: false,
      error: "Unknown SimpleFIN account.",
    });
    expect(mapAccount(db, "ACT-1", 999)).toEqual({
      ok: false,
      error: "Unknown account.",
    });
    expect(mapAccount(db, "ACT-2", chk.id)).toEqual({
      ok: false,
      error: "Only USD accounts can be synced.",
    });
    expect(mapAccount(db, "ACT-1", chk.id)).toEqual({ ok: true });
    expect(mapAccount(db, "ACT-3", chk.id)).toEqual({
      ok: false,
      error: "That account is already linked to another SimpleFIN account.",
    });
    expect(mapAccount(db, "ACT-1", null)).toEqual({ ok: true });
    expect(mapAccount(db, "ACT-3", chk.id)).toEqual({ ok: true });
  });

  it("deleting an app account unmaps the linked account instead of failing", () => {
    const { db, chk } = seed();
    upsertLinkedAccounts(db, [sfin()]);
    mapAccount(db, "ACT-1", chk.id);
    expect(deleteAccountIfEmpty(db, chk.id)).toMatchObject({ ok: true });
    expect(db.select().from(simplefinAccounts).all()[0].accountId).toBeNull();
  });

  it("earliestSyncedDate looks only at rows with an external id", () => {
    const { db, chk } = seed();
    expect(earliestSyncedDate(db)).toBeNull();
    db.insert(transactions)
      .values([
        {
          accountId: chk.id,
          date: "2026-01-01",
          amountCents: -1,
          rawDescription: "csv",
          merchant: "csv",
          dedupeHash: "h1",
        },
        {
          accountId: chk.id,
          date: "2026-06-15",
          amountCents: -1,
          rawDescription: "sfin",
          merchant: "sfin",
          dedupeHash: "h2",
          externalId: "x1",
        },
        {
          accountId: chk.id,
          date: "2026-07-01",
          amountCents: -1,
          rawDescription: "sfin",
          merchant: "sfin",
          dedupeHash: "h3",
          externalId: "x2",
        },
      ])
      .run();
    expect(earliestSyncedDate(db)).toBe("2026-06-15");
    expect(getConnection(db, NOW).earliestSynced).toBe("2026-06-15");
  });

  it("the partial unique index rejects a duplicate external id per account but allows many nulls", () => {
    const { db, chk } = seed();
    const base = {
      accountId: chk.id,
      date: "2026-06-15",
      amountCents: -1,
      rawDescription: "r",
      merchant: "r",
    };
    db.insert(transactions)
      .values([
        { ...base, dedupeHash: "a" },
        { ...base, dedupeHash: "b" },
        { ...base, dedupeHash: "c", externalId: "x1" },
      ])
      .run();
    expect(() =>
      db
        .insert(transactions)
        .values({ ...base, dedupeHash: "d", externalId: "x1" })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("reports stale banks from the linked accounts' balance dates", () => {
    const { db, chk } = seed();
    setAccessUrl(db, ACCESS, NOW);
    upsertLinkedAccounts(db, [sfin()]); // balance dated 2026-09-05
    mapAccount(db, "ACT-1", chk.id);
    // Synced nine days after the bank last sent anything.
    setLastSyncAt(db, "2026-09-14T17:00:00.000Z");
    expect(getConnection(db, NOW).staleBanks).toEqual([
      {
        orgName: "Test Bank",
        lastUpdated: dayOfSeconds(1788566400),
        accounts: ["Checking"],
      },
    ]);
  });
});
