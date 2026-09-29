import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { openDb } from "@/lib/db/client";
import { accounts, imports, simplefinAccounts } from "@/lib/db/schema";
import {
  accountImportRows,
  completeWeek,
  listWeekStarts,
} from "@/lib/ritual/store";

describe("completeWeek", () => {
  it("creates one row for the week and is a no-op on a second call in the same week", () => {
    const db = openDb(":memory:");
    const first = completeWeek(db, "2026-09-06"); // Sunday, week of 2026-08-31
    expect(first).toEqual({ weekStart: "2026-08-31", created: true });

    const second = completeWeek(db, "2026-09-05"); // Saturday, same week
    expect(second).toEqual({ weekStart: "2026-08-31", created: false });

    expect(listWeekStarts(db)).toHaveLength(1);
    // completedAt carries the local date passed in, not the UTC default.
    expect(listWeekStarts(db)[0].completedAt.slice(0, 10)).toBe("2026-09-06");
  });

  it("creates a separate row for a later week", () => {
    const db = openDb(":memory:");
    completeWeek(db, "2026-08-24");
    completeWeek(db, "2026-09-06");
    expect(
      listWeekStarts(db)
        .map((r) => r.weekStart)
        .sort(),
    ).toEqual(["2026-08-24", "2026-08-31"]);
  });
});

describe("listWeekStarts", () => {
  it("returns weekStart and completedAt for every completed review", () => {
    const db = openDb(":memory:");
    completeWeek(db, "2026-08-24");
    const rows = listWeekStarts(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].weekStart).toBe("2026-08-24");
    expect(typeof rows[0].completedAt).toBe("string");
  });
});

describe("accountImportRows", () => {
  it("takes the newest import per account and reports never for accounts with none", () => {
    const db = openDb(":memory:");
    const [checking] = db
      .insert(accounts)
      .values({ name: "Checking", type: "checking" })
      .returning()
      .all();
    const [savings] = db
      .insert(accounts)
      .values({ name: "Savings", type: "savings" })
      .returning()
      .all();
    db.insert(imports)
      .values({
        accountId: checking.id,
        filename: "jan.csv",
        fileHash: "h1",
        rowCount: 1,
        newCount: 1,
        dupCount: 0,
        importedAt: "2026-08-20T00:00:00.000Z",
      })
      .run();
    db.insert(imports)
      .values({
        accountId: checking.id,
        filename: "sep.csv",
        fileHash: "h2",
        rowCount: 1,
        newCount: 1,
        dupCount: 0,
        importedAt: "2026-09-01T00:00:00.000Z",
      })
      .run();

    const rows = accountImportRows(db, "2026-09-06");
    const c = rows.find((r) => r.id === checking.id);
    const s = rows.find((r) => r.id === savings.id);

    expect(c?.lastImport?.slice(0, 10)).toBe("2026-09-01"); // newest wins
    expect(c?.daysSince).toBe(5);
    expect(c?.staleness).toBe("fresh");

    expect(s?.lastImport).toBeNull();
    expect(s?.daysSince).toBeNull();
    expect(s?.staleness).toBe("never");
    expect(c?.syncedAt).toBeNull();
  });

  it("measures a linked account from its last sync, not its last import", () => {
    const db = openDb(":memory:");
    const [checking] = db
      .insert(accounts)
      .values({ name: "Checking", type: "checking" })
      .returning()
      .all();
    db.insert(imports)
      .values({
        accountId: checking.id,
        filename: "may.csv",
        fileHash: "h1",
        rowCount: 1,
        newCount: 1,
        dupCount: 0,
        importedAt: "2026-05-01T00:00:00.000Z",
      })
      .run();
    db.insert(simplefinAccounts)
      .values({
        sfinId: "ACT-1",
        name: "Everyday Checking",
        accountId: checking.id,
        lastSyncedAt: "2026-09-05T09:00:00.000Z",
      })
      .run();

    const [row] = accountImportRows(db, "2026-09-06");
    expect(row.syncedAt).toBe("2026-09-05T09:00:00.000Z");
    expect(row.lastImport?.slice(0, 10)).toBe("2026-05-01"); // still reported
    expect(row.daysSince).toBe(1);
    expect(row.staleness).toBe("fresh");
  });

  it("never reports a negative age for a UTC stamp written last night", () => {
    const db = openDb(":memory:");
    const [checking] = db
      .insert(accounts)
      .values({ name: "Checking", type: "checking" })
      .returning()
      .all();
    const today = "2026-09-06";
    db.insert(imports)
      .values({
        accountId: checking.id,
        filename: "sep.csv",
        fileHash: "h1",
        rowCount: 1,
        newCount: 1,
        dupCount: 0,
        // An evening import before the fix: stamped in UTC, so its date reads
        // as tomorrow while the user is still on today.
        importedAt: `${addDays(today, 1)}T01:00:00.000Z`,
      })
      .run();

    const [row] = accountImportRows(db, today);
    expect(row.daysSince).toBe(0);
    expect(row.staleness).toBe("fresh");
  });

  it("ignores a disabled link and falls back to import staleness", () => {
    const db = openDb(":memory:");
    const [checking] = db
      .insert(accounts)
      .values({ name: "Checking", type: "checking" })
      .returning()
      .all();
    db.insert(imports)
      .values({
        accountId: checking.id,
        filename: "aug.csv",
        fileHash: "h1",
        rowCount: 1,
        newCount: 1,
        dupCount: 0,
        importedAt: "2026-08-01T00:00:00.000Z",
      })
      .run();
    db.insert(simplefinAccounts)
      .values({
        sfinId: "ACT-1",
        name: "Everyday Checking",
        accountId: checking.id,
        enabled: false,
        lastSyncedAt: "2026-09-05T09:00:00.000Z",
      })
      .run();

    const [row] = accountImportRows(db, "2026-09-06");
    expect(row.syncedAt).toBeNull();
    expect(row.daysSince).toBe(36);
    expect(row.staleness).toBe("stale");
  });
});
