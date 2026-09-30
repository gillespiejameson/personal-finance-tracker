import { describe, expect, it, vi } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { localDay, todayIso } from "@/lib/dates";
import { openDb } from "@/lib/db/client";
import { accounts, imports, transactions } from "@/lib/db/schema";
import { commitImport, undoImport } from "@/lib/import/commit";
import { listSnapshots, recordSnapshots } from "@/lib/networth/store";
import { ensureBuiltinAliases } from "@/lib/normalize/aliases";
import { REJECTED_ERROR } from "@/lib/simplefin/client";
import {
  getConnection,
  getHistoryFloor,
  getLastAttemptAt,
  listLinkedAccounts,
  mapAccount,
  markAccountSynced,
  setAccessUrl,
  setEnabled,
  setLastSyncAt,
  upsertLinkedAccounts,
} from "@/lib/simplefin/store";
import {
  NO_OLDER_WARNING,
  NOT_CONNECTED_ERROR,
  plainReason,
  runSync,
  SYNC_FAILED_ERROR,
  syncPayload,
} from "@/lib/simplefin/sync";
import type {
  SfinAccount,
  SfinPayload,
  SfinTransaction,
} from "@/lib/simplefin/types";
import { mustFind } from "../helpers";

/**
 * `recordSnapshots` stands in for "anything the database can refuse": the
 * spy is the real function until a test makes one call throw.
 */
vi.mock("@/lib/networth/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/networth/store")>();
  return { ...actual, recordSnapshots: vi.fn(actual.recordSnapshots) };
});

const DAY = 86_400;
const NOW = new Date("2026-09-07T15:30:00Z");
const NOW_S = 1788795000;
/** `firstWindow(NOW)`: the UTC midnight an hour inside the 90-day cap. */
const FIRST_START = 1781049600;
const LATER = new Date("2026-09-08T09:00:00Z");
const ACCESS = "https://u:p@sfin.test/simplefin";

/** Unix seconds at UTC noon of a date. */
const at = (iso: string) =>
  Math.floor(new Date(`${iso}T12:00:00Z`).getTime() / 1000);

/** The balance date is an instant, so its recorded day is the local one. */
const dayOfSeconds = (seconds: number) => localDay(new Date(seconds * 1000));
/** The day every fixture account's default `balance-date` lands on. */
const BALANCE_DAY = dayOfSeconds(at("2026-09-06"));

const txn = (
  id: string,
  date: string,
  amount: string,
  description: string,
  over: Partial<SfinTransaction> = {},
): SfinTransaction => ({
  id,
  posted: at(date),
  amount,
  description,
  ...over,
});

const pendingTxn = (
  id: string,
  date: string,
  amount: string,
  description: string,
): SfinTransaction => ({
  id,
  posted: 0,
  pending: true,
  transacted_at: at(date),
  amount,
  description,
});

const account = (
  id: string,
  transactions: SfinTransaction[],
  over: Partial<SfinAccount> = {},
): SfinAccount => ({
  id,
  org: { name: "Test Bank" },
  name: id === "ACT-1" ? "Checking" : "Card",
  currency: "USD",
  balance: "1234.56",
  "balance-date": at("2026-09-06"),
  transactions,
  ...over,
});

function seed() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  ensureBuiltinAliases(db);
  const [chk] = db
    .insert(accounts)
    .values({ name: "Chk", type: "checking" })
    .returning()
    .all();
  const [card] = db
    .insert(accounts)
    .values({ name: "Card", type: "credit" })
    .returning()
    .all();
  upsertLinkedAccounts(db, [account("ACT-1", []), account("ACT-2", [])]);
  expect(mapAccount(db, "ACT-1", chk.id)).toEqual({ ok: true });
  return { db, chk, card };
}

const allTxns = (db: ReturnType<typeof openDb>) =>
  db.select().from(transactions).orderBy(transactions.id).all();

describe("syncPayload", () => {
  it("stores a credit card's negative balance as a positive amount owed", () => {
    const { db, card } = seed();
    expect(mapAccount(db, "ACT-2", card.id)).toEqual({ ok: true });
    const payload: SfinPayload = {
      accounts: [
        account("ACT-2", [txn("c1", "2026-09-01", "-99.00", "AMAZON")], {
          balance: "-320.40",
        }),
      ],
    };
    syncPayload(db, payload, { now: NOW });
    // Net worth subtracts liabilities, so a card owing $320.40 is +32040.
    expect(listSnapshots(db)).toEqual([
      { accountId: card.id, date: BALANCE_DAY, balanceCents: 32040 },
    ]);
  });

  it("dates the balance snapshot by the local day of the balance instant", () => {
    const { db, chk } = seed();
    // 02:00 UTC is the previous evening west of Greenwich: the balance is an
    // instant, so the day it belongs to is the local one, not the UTC one.
    const instant = new Date("2026-09-08T02:00:00Z");
    const seconds = Math.floor(instant.getTime() / 1000);
    const payload: SfinPayload = {
      accounts: [
        account("ACT-1", [txn("t1", "2026-09-01", "-12.34", "KROGER")], {
          "balance-date": seconds,
        }),
      ],
    };
    syncPayload(db, payload, { now: NOW });
    expect(listSnapshots(db)).toEqual([
      { accountId: chk.id, date: localDay(instant), balanceCents: 123456 },
    ]);
    expect(
      mustFind(listLinkedAccounts(db), (l) => l.sfinId === "ACT-1", "ACT-1")
        .balanceDate,
    ).toBe(localDay(instant));
  });

  it("inserts rows with external ids, records the balance, skips unmapped accounts", () => {
    const { db, chk } = seed();
    const payload: SfinPayload = {
      errors: [],
      accounts: [
        account("ACT-1", [
          txn("t1", "2026-09-01", "-12.34", "KROGER #123"),
          txn("t2", "2026-09-02", "2500.00", "ACME PAYROLL"),
          pendingTxn("t3", "2026-09-06", "-4.50", "STARBUCKS"),
        ]),
        account("ACT-2", [txn("c1", "2026-09-01", "-99.00", "AMAZON")]),
      ],
    };
    const { results, warnings } = syncPayload(db, payload, { now: NOW });
    expect(warnings).toEqual([]);
    expect(results).toEqual([
      {
        sfinId: "ACT-1",
        name: "Checking",
        added: 3,
        updated: 0,
        matched: 0,
        pending: 1,
        removed: 0,
        balanceRecorded: true,
      },
    ]);
    const rows = allTxns(db);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.accountId === chk.id)).toBe(true);
    expect(rows.map((r) => r.externalId)).toEqual(["t1", "t2", "t3"]);
    expect(rows.map((r) => r.pending)).toEqual([false, false, true]);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-06",
    ]);
    expect(rows[0].amountCents).toBe(-1234);
    expect(rows[0].merchant).toBe("Kroger");
    expect(listSnapshots(db)).toEqual([
      { accountId: chk.id, date: BALANCE_DAY, balanceCents: 123456 },
    ]);
    // One imports row for the sync, hashed from its filename, undo-able.
    const imps = db.select().from(imports).all();
    expect(imps).toHaveLength(1);
    expect(imps[0]).toMatchObject({
      accountId: chk.id,
      filename: `simplefin:ACT-1:${NOW.toISOString()}`,
      rowCount: 3,
      newCount: 3,
      dupCount: 0,
    });
    expect(rows.every((r) => r.importId === imps[0].id)).toBe(true);
    // The sync's imports row is stamped local, like a CSV import's.
    expect(imps[0].importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(imps[0].importedAt.slice(0, 10)).toBe(todayIso());
    // The unmapped card is listed with a fresh balance, not synced.
    const card = mustFind(
      listLinkedAccounts(db),
      (l) => l.sfinId === "ACT-2",
      "ACT-2",
    );
    expect(card).toMatchObject({ accountId: null, balanceCents: 123456 });
    expect(card.lastSyncedAt).toBeNull();
    expect(
      mustFind(listLinkedAccounts(db), (l) => l.sfinId === "ACT-1", "ACT-1")
        .lastSyncedAt,
    ).toBe(NOW.toISOString());
  });

  it("categorizes fresh rows like a CSV import would", () => {
    const { db } = seed();
    syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn("t1", "2026-09-01", "-66.66", "H-E-B #042 SPRINGFIELD IL"),
          ]),
        ],
      },
      { now: NOW },
    );
    // Builtin rules are not seeded here; the transfer pass still ran and left
    // the row a plain, unreviewed purchase.
    expect(allTxns(db)[0]).toMatchObject({
      isTransfer: false,
      reviewed: false,
    });
  });

  it("two syncs with overlapping windows add nothing twice", () => {
    const { db } = seed();
    const first = [
      txn("t1", "2026-09-01", "-12.34", "KROGER #123"),
      txn("t2", "2026-09-02", "2500.00", "ACME PAYROLL"),
    ];
    syncPayload(db, { accounts: [account("ACT-1", first)] }, { now: NOW });
    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            ...first,
            txn("t3", "2026-09-07", "-8.00", "COFFEE"),
          ]),
        ],
      },
      { now: LATER },
    );
    expect(results[0]).toMatchObject({ added: 1, updated: 0, matched: 0 });
    expect(allTxns(db)).toHaveLength(3);
    expect(db.select().from(imports).all()).toHaveLength(2);
  });

  it("updates a pending row in place when it posts on a later date, keeping its category", () => {
    const { db, chk } = seed();
    syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            pendingTxn("p1", "2026-09-05", "-45.00", "SHELL OIL"),
          ]),
        ],
      },
      { now: NOW },
    );
    const before = allTxns(db)[0];
    expect(before).toMatchObject({ pending: true, date: "2026-09-05" });
    const groceries = findCategoryId(db, "Groceries") as number;
    db.update(transactions)
      .set({ categoryId: groceries, reviewed: true, notes: "kept" })
      .run();

    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn("p1", "2026-09-07", "-45.00", "SHELL OIL 4432"),
          ]),
        ],
      },
      { now: LATER },
    );
    expect(results[0]).toMatchObject({ added: 0, updated: 1, pending: 0 });
    const rows = allTxns(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: before.id,
      accountId: chk.id,
      date: "2026-09-07",
      pending: false,
      rawDescription: "SHELL OIL 4432",
      merchant: "Shell",
      categoryId: groceries,
      reviewed: true,
      notes: "kept",
    });
    expect(rows[0].dedupeHash).not.toBe(before.dedupeHash);
    // Unchanged rows are not counted as updates.
    const again = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn("p1", "2026-09-07", "-45.00", "SHELL OIL 4432"),
          ]),
        ],
      },
      { now: LATER },
    );
    expect(again.results[0]).toMatchObject({ added: 0, updated: 0 });
  });

  it("attaches the external id to a CSV-imported twin instead of inserting", () => {
    const { db, chk } = seed();
    commitImport(db, {
      accountId: chk.id,
      filename: "a.csv",
      text: "file-a",
      rows: [
        {
          date: "2026-09-01",
          amountCents: -1234,
          rawDescription: "KROGER #123",
          merchant: "Kroger",
        },
      ],
    });
    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn("t1", "2026-09-01", "-12.34", "Kroger #123"),
            txn("t2", "2026-09-01", "-12.34", "KROGER #123"), // a real second purchase
          ]),
        ],
      },
      { now: NOW },
    );
    expect(results[0]).toMatchObject({ added: 1, matched: 1, updated: 0 });
    const rows = allTxns(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      externalId: "t1",
      importId: expect.any(Number),
    });
    expect(rows[1]).toMatchObject({ externalId: "t2" });
    expect(rows[0].importId).not.toBe(rows[1].importId);
  });

  /** A CSV export of the same charge; the feed words it differently. */
  const csvRow = (
    db: ReturnType<typeof openDb>,
    accountId: number,
    filename: string,
    date: string,
    amountCents: number,
    rawDescription: string,
  ) =>
    commitImport(db, {
      accountId,
      filename,
      text: filename,
      rows: [{ date, amountCents, rawDescription, merchant: rawDescription }],
    });

  it("claims a differently worded CSV twin within three days instead of inserting", () => {
    const { db, chk } = seed();
    csvRow(
      db,
      chk.id,
      "a.csv",
      "2026-09-04",
      -2132,
      "VERCEL INC. VERCEL.COM CA",
    );
    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn(
              "t1",
              "2026-09-03",
              "-21.32",
              "VERCEL INC. VERCEL.COM CA 4242 - CARDHOLDER",
            ),
          ]),
        ],
      },
      { now: NOW },
    );
    expect(results[0]).toMatchObject({ added: 0, matched: 1, updated: 0 });
    const rows = allTxns(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "t1",
      // The CSV's wording and date are left alone; only the id is attached.
      date: "2026-09-04",
      rawDescription: "VERCEL INC. VERCEL.COM CA",
    });
  });

  it("lets one CSV twin be claimed once, so the second feed row inserts", () => {
    const { db, chk } = seed();
    csvRow(
      db,
      chk.id,
      "a.csv",
      "2026-09-04",
      -2132,
      "VERCEL INC. VERCEL.COM CA",
    );
    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn(
              "t1",
              "2026-09-03",
              "-21.32",
              "VERCEL INC. VERCEL.COM CA 4242 - CARDHOLDER",
            ),
            txn(
              "t2",
              "2026-09-04",
              "-21.32",
              "VERCEL INC. VERCEL.COM CA 4242 - CARDHOLDER",
            ),
          ]),
        ],
      },
      { now: NOW },
    );
    expect(results[0]).toMatchObject({ added: 1, matched: 1 });
    expect(allTxns(db)).toHaveLength(2);
  });

  it("does not claim a same-amount row five days away", () => {
    const { db, chk } = seed();
    csvRow(
      db,
      chk.id,
      "a.csv",
      "2026-09-04",
      -2132,
      "VERCEL INC. VERCEL.COM CA",
    );
    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn(
              "t1",
              "2026-08-30",
              "-21.32",
              "VERCEL INC. VERCEL.COM CA 4242 - CARDHOLDER",
            ),
          ]),
        ],
      },
      { now: NOW },
    );
    expect(results[0]).toMatchObject({ added: 1, matched: 0 });
    expect(allTxns(db)).toHaveLength(2);
  });

  it("never re-claims a row that already carries an external id", () => {
    const { db, chk } = seed();
    csvRow(
      db,
      chk.id,
      "a.csv",
      "2026-09-04",
      -2132,
      "VERCEL INC. VERCEL.COM CA",
    );
    syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn(
              "t1",
              "2026-09-03",
              "-21.32",
              "VERCEL INC. VERCEL.COM CA 4242 - CARDHOLDER",
            ),
          ]),
        ],
      },
      { now: NOW },
    );
    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn(
              "t2",
              "2026-09-05",
              "-21.32",
              "VERCEL INC. VERCEL.COM CA 4242 - CARDHOLDER",
            ),
          ]),
        ],
      },
      { now: LATER },
    );
    expect(results[0]).toMatchObject({ added: 1, matched: 0 });
    const rows = allTxns(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.externalId).sort()).toEqual(["t1", "t2"]);
  });

  it("does not fuzzy-claim a row an exact hash match already took in the same batch", () => {
    const { db, chk } = seed();
    csvRow(
      db,
      chk.id,
      "a.csv",
      "2026-09-04",
      -2132,
      "VERCEL INC. VERCEL.COM CA",
    );
    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            // Same wording as the CSV row: matched by dedupe hash first.
            txn("t1", "2026-09-04", "-21.32", "VERCEL INC. VERCEL.COM CA"),
            txn(
              "t2",
              "2026-09-03",
              "-21.32",
              "VERCEL INC. VERCEL.COM CA 4242 - CARDHOLDER",
            ),
          ]),
        ],
      },
      { now: NOW },
    );
    expect(results[0]).toMatchObject({ added: 1, matched: 1 });
    const rows = allTxns(db);
    expect(rows).toHaveLength(2);
    // The hash match keeps the row it claimed; the fuzzy pass cannot take it.
    expect(
      mustFind(
        rows,
        (r) => r.rawDescription === "VERCEL INC. VERCEL.COM CA",
        "the CSV row",
      ).externalId,
    ).toBe("t1");
  });

  it("lets the exact twin win even when the fuzzy row comes first in the feed", () => {
    const { db, chk } = seed();
    csvRow(
      db,
      chk.id,
      "a.csv",
      "2026-09-04",
      -2132,
      "VERCEL INC. VERCEL.COM CA",
    );
    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            // The loosely worded row is offered first, but every exact match
            // is resolved before any fuzzy claim, so it cannot take the CSV
            // row away from its exact twin below.
            txn(
              "t2",
              "2026-09-03",
              "-21.32",
              "VERCEL INC. VERCEL.COM CA 4242 - CARDHOLDER",
            ),
            txn("t1", "2026-09-04", "-21.32", "VERCEL INC. VERCEL.COM CA"),
          ]),
        ],
      },
      { now: NOW },
    );
    expect(results[0]).toMatchObject({ added: 1, matched: 1 });
    const rows = allTxns(db);
    // Two rows, not three: the 09-04 CSV row is not duplicated.
    expect(rows).toHaveLength(2);
    expect(
      mustFind(
        rows,
        (r) => r.rawDescription === "VERCEL INC. VERCEL.COM CA",
        "the CSV row",
      ),
    ).toMatchObject({ externalId: "t1", date: "2026-09-04" });
    // t2 is a different charge on 09-03; it is inserted, not merged.
    expect(
      mustFind(rows, (r) => r.externalId === "t2", "the feed row"),
    ).toMatchObject({ date: "2026-09-03" });
  });

  it("never lets a pending feed row claim a posted CSV row", () => {
    const { db, chk } = seed();
    csvRow(
      db,
      chk.id,
      "a.csv",
      "2026-09-04",
      -2132,
      "VERCEL INC. VERCEL.COM CA",
    );
    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            pendingTxn(
              "p1",
              "2026-09-03",
              "-21.32",
              "VERCEL INC. VERCEL.COM CA 4242 - CARDHOLDER",
            ),
          ]),
        ],
      },
      { now: NOW },
    );
    // A CSV export is older than the live feed, so a still-pending feed row
    // cannot be the posted row in the file: it inserts on its own.
    expect(results[0]).toMatchObject({ added: 1, matched: 0, pending: 1 });
    const rows = allTxns(db);
    expect(rows).toHaveLength(2);
    expect(
      mustFind(
        rows,
        (r) => r.rawDescription === "VERCEL INC. VERCEL.COM CA",
        "the CSV row",
      ),
    ).toMatchObject({ externalId: null, pending: false });
    expect(
      mustFind(rows, (r) => r.externalId === "p1", "the pending row"),
    ).toMatchObject({ pending: true, date: "2026-09-03" });
  });

  it("surfaces payload errors and unparseable rows as warnings", () => {
    const { db } = seed();
    const { results, warnings } = syncPayload(
      db,
      {
        errors: ["Connection to Test Bank may need attention"],
        accounts: [
          account("ACT-1", [
            txn("t1", "2026-09-01", "1,000.00", "BAD AMOUNT"),
            txn("t2", "2026-09-01", "-5.00", "OK"),
          ]),
        ],
      },
      { now: NOW },
    );
    expect(warnings).toEqual([
      "Connection to Test Bank may need attention",
      'Checking: Skipped transaction t1: unreadable amount "1,000.00".',
    ]);
    expect(results[0].added).toBe(1);
  });

  it("removes vanished pending rows older than 14 days, keeps younger ones", () => {
    const { db } = seed();
    syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            pendingTxn("old", "2026-08-15", "-10.00", "OLD HOLD"),
            pendingTxn("young", "2026-09-03", "-20.00", "YOUNG HOLD"),
            pendingTxn("posted", "2026-08-10", "-30.00", "WILL POST"),
          ]),
        ],
      },
      { now: NOW },
    );
    expect(allTxns(db)).toHaveLength(3);

    // A later sync covering those dates reports neither hold; "posted" comes back posted.
    const window = { start: NOW_S - 60 * DAY, end: NOW_S };
    const { results } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn("posted", "2026-08-12", "-30.00", "WILL POST"),
          ]),
        ],
      },
      { now: NOW, window },
    );
    expect(results[0]).toMatchObject({ removed: 1, updated: 1 });
    expect(
      allTxns(db)
        .map((r) => r.externalId)
        .sort(),
    ).toEqual(["posted", "young"]);
  });

  it("leaves vanished pending rows alone outside the fetched window", () => {
    const { db } = seed();
    syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            pendingTxn("old", "2026-06-15", "-10.00", "OLD HOLD"),
          ]),
        ],
      },
      { now: NOW },
    );
    const { results } = syncPayload(
      db,
      { accounts: [account("ACT-1", [])] },
      { now: NOW, window: { start: NOW_S - 7 * DAY, end: NOW_S } },
    );
    expect(results[0].removed).toBe(0);
    expect(allTxns(db)).toHaveLength(1);
  });

  it("collapses a duplicate id in one feed, keeping the last copy", () => {
    const { db } = seed();
    const { results, warnings } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn("dup", "2026-09-01", "-12.34", "KROGER #123"),
            txn("dup", "2026-09-01", "-12.34", "KROGER #123 CORRECTED"),
            txn("t2", "2026-09-02", "-5.00", "OK"),
          ]),
        ],
      },
      { now: NOW },
    );
    // The per-account unique index would have refused the second copy and
    // taken the whole account down with it; instead it is folded in quietly.
    expect(warnings).toEqual([
      "Checking: 1 duplicate id in the feed was collapsed",
    ]);
    expect(results[0]).toMatchObject({ added: 2, updated: 0 });
    const rows = allTxns(db);
    expect(rows).toHaveLength(2);
    expect(
      mustFind(rows, (r) => r.externalId === "dup", "the surviving copy")
        .rawDescription,
    ).toBe("KROGER #123 CORRECTED");
  });

  it("reports one account's failure as a warning and still syncs the others", () => {
    const { db, card } = seed();
    expect(mapAccount(db, "ACT-2", card.id)).toEqual({ ok: true });
    vi.mocked(recordSnapshots).mockImplementationOnce(() => {
      throw new Error(`disk I/O error writing ${ACCESS}`);
    });
    const { results, warnings } = syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [txn("t1", "2026-09-01", "-12.34", "KROGER")]),
          account("ACT-2", [txn("c1", "2026-09-01", "-99.00", "AMAZON")]),
        ],
      },
      { now: NOW },
    );
    expect(warnings).toEqual([
      "Checking: sync failed — disk I/O error writing …",
    ]);
    expect(warnings[0]).not.toContain("sfin.test");
    // The failed account's transaction rolled back with it; the card synced.
    expect(results).toEqual([
      expect.objectContaining({ sfinId: "ACT-2", added: 1 }),
    ]);
    expect(allTxns(db).map((r) => r.externalId)).toEqual(["c1"]);
    expect(
      mustFind(listLinkedAccounts(db), (l) => l.sfinId === "ACT-1", "ACT-1")
        .lastSyncedAt,
    ).toBeNull();
  });

  it("keeps vanished pending rows when the payload is empty or carries errors", () => {
    const { db } = seed();
    syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            pendingTxn("old", "2026-08-15", "-10.00", "OLD HOLD"),
          ]),
        ],
      },
      { now: NOW },
    );
    const window = { start: NOW_S - 60 * DAY, end: NOW_S };
    // Nothing came back at all: a hiccup, not proof the hold cleared.
    const empty = syncPayload(
      db,
      { accounts: [account("ACT-1", [])] },
      { now: NOW, window },
    );
    expect(empty.results[0].removed).toBe(0);
    expect(allTxns(db)).toHaveLength(1);
    // Rows came back, but so did an error: the feed is not to be trusted.
    const errored = syncPayload(
      db,
      {
        errors: ["Bank X needs re-authentication"],
        accounts: [
          account("ACT-1", [txn("other", "2026-09-01", "-5.00", "OTHER")]),
        ],
      },
      { now: NOW, window },
    );
    expect(errored.results[0].removed).toBe(0);
    expect(allTxns(db)).toHaveLength(2);
  });

  it("does not sync a disabled account", () => {
    const { db } = seed();
    setEnabled(db, "ACT-1", false);
    const { results } = syncPayload(
      db,
      { accounts: [account("ACT-1", [txn("t1", "2026-09-01", "-1.00", "X")])] },
      { now: NOW },
    );
    expect(results).toEqual([]);
    expect(allTxns(db)).toHaveLength(0);
  });

  it("undoImport of one sync removes only the rows that sync inserted", () => {
    const { db, chk } = seed();
    commitImport(db, {
      accountId: chk.id,
      filename: "a.csv",
      text: "file-a",
      rows: [
        {
          date: "2026-09-01",
          amountCents: -1234,
          rawDescription: "KROGER #123",
          merchant: "Kroger",
        },
      ],
    });
    syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [txn("t0", "2026-08-30", "-3.00", "FIRST")]),
        ],
      },
      { now: NOW },
    );
    syncPayload(
      db,
      {
        accounts: [
          account("ACT-1", [
            txn("t0", "2026-08-30", "-3.00", "FIRST"),
            txn("t1", "2026-09-01", "-12.34", "KROGER #123"), // attaches to the CSV row
            txn("t2", "2026-09-02", "-7.00", "SECOND"),
          ]),
        ],
      },
      { now: LATER },
    );
    expect(allTxns(db)).toHaveLength(3);
    const imps = db.select().from(imports).orderBy(imports.id).all();
    expect(imps.map((i) => i.filename)).toEqual([
      "a.csv",
      `simplefin:ACT-1:${NOW.toISOString()}`,
      `simplefin:ACT-1:${LATER.toISOString()}`,
    ]);
    expect(undoImport(db, imps[2].id)).toBe(1);
    const left = allTxns(db);
    expect(left.map((r) => r.externalId).sort()).toEqual(["t0", "t1"]);
    expect(
      mustFind(left, (r) => r.externalId === "t1", "the CSV row").importId,
    ).toBe(imps[0].id);
  });
});

type Call = { url: string; init?: RequestInit };

function fakeFetch(respond: (call: Call, n: number) => Response): {
  fetchFn: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call, calls.length);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const json = (payload: SfinPayload) =>
  new Response(JSON.stringify(payload), { status: 200 });

describe("runSync", () => {
  it("refuses when not connected", async () => {
    const { db } = seed();
    const { fetchFn, calls } = fakeFetch(() => json({ accounts: [] }));
    expect(await runSync(db, fetchFn, { now: NOW, automatic: false })).toEqual({
      ok: false,
      error: NOT_CONNECTED_ERROR,
    });
    expect(calls).toHaveLength(0);
  });

  it("first sync fetches the last 90 days with pending, then catches up with overlap", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    const { fetchFn, calls } = fakeFetch(() =>
      json({
        accounts: [
          account("ACT-1", [txn("t1", "2026-09-01", "-12.34", "KROGER")]),
        ],
      }),
    );
    const first = await runSync(db, fetchFn, { now: NOW, automatic: false });
    expect(first).toEqual({
      ok: true,
      results: [expect.objectContaining({ sfinId: "ACT-1", added: 1 })],
      warnings: [],
      requests: 1,
    });
    expect(calls[0].url).toBe(
      `https://sfin.test/simplefin/accounts?start-date=${FIRST_START}&end-date=${NOW_S}&pending=1`,
    );
    expect(calls[0].url).not.toContain("u:p");
    expect(getConnection(db, NOW)).toMatchObject({
      lastSyncAt: NOW.toISOString(),
      requestsToday: 1,
    });

    // Ten minutes later an automatic sync is gated, a manual one is not.
    const soon = new Date(NOW.getTime() + 10 * 60_000);
    const soonS = NOW_S + 600;
    // The overlap is floored to the midnight of five days back.
    const overlapStart = 1788307200; // 2026-09-02T00:00:00Z
    // The overlap counts back from the last sync, not from now.
    expect(await runSync(db, fetchFn, { now: soon, automatic: true })).toEqual({
      ok: false,
      error: "Synced less than 30 minutes ago.",
    });
    expect(calls).toHaveLength(1);
    const second = await runSync(db, fetchFn, { now: soon, automatic: false });
    expect(second).toMatchObject({ ok: true, requests: 1 });
    expect(calls[1].url).toBe(
      `https://sfin.test/simplefin/accounts?start-date=${overlapStart}&end-date=${soonS}&pending=1`,
    );
    expect(allTxns(db)).toHaveLength(1);
    expect(getConnection(db, soon)).toMatchObject({
      lastSyncAt: soon.toISOString(),
      requestsToday: 2,
    });
  });

  it("splits a long gap into chunks, each with its own imports row", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    setLastSyncAt(db, new Date(NOW.getTime() - 100 * DAY * 1000).toISOString());
    // The catch-up path is only taken once every mapped link has synced.
    markAccountSynced(
      db,
      "ACT-1",
      new Date(NOW.getTime() - 100 * DAY * 1000).toISOString(),
    );
    const { fetchFn, calls } = fakeFetch((_call, n) =>
      json({
        accounts: [
          account("ACT-1", [txn(`t${n}`, "2026-09-01", "-1.00", `ROW ${n}`)]),
        ],
      }),
    );
    const out = await runSync(db, fetchFn, { now: NOW, automatic: false });
    expect(out).toMatchObject({ ok: true, requests: 2 });
    if (!out.ok) throw new Error("unreachable");
    expect(out.results).toEqual([expect.objectContaining({ added: 2 })]);
    expect(
      calls.map((c) => new URL(c.url).searchParams.get("start-date")),
    ).toEqual(["1779667200", "1787356800"]);
    expect(db.select().from(imports).all()).toHaveLength(2);
    expect(getConnection(db, NOW).requestsToday).toBe(2);
  });

  it("fetches the full first window for a newly mapped account, then catches up", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    // The connection has synced before; this account was mapped afterwards,
    // so the five-day overlap would never reach its history.
    setLastSyncAt(db, "2026-09-06T00:00:00Z");
    const { fetchFn, calls } = fakeFetch(() =>
      json({
        accounts: [
          account("ACT-1", [txn("t1", "2026-08-10", "-12.34", "KROGER")]),
        ],
      }),
    );
    const first = await runSync(db, fetchFn, { now: NOW, automatic: false });
    expect(first).toMatchObject({ ok: true, requests: 1 });
    expect(calls).toHaveLength(1);
    const params = new URL(calls[0].url).searchParams;
    expect(params.get("start-date")).toBe(String(FIRST_START));
    expect(params.get("end-date")).toBe(String(NOW_S));
    // A row 28 days back only arrives inside a 90-day window.
    expect(allTxns(db).map((r) => r.date)).toEqual(["2026-08-10"]);

    // With every mapped link synced, the next run is the ordinary overlap.
    const soon = new Date(NOW.getTime() + 60 * 60_000);
    const second = await runSync(db, fetchFn, { now: soon, automatic: false });
    expect(second).toMatchObject({ ok: true, requests: 1 });
    expect(new URL(calls[1].url).searchParams.get("start-date")).toBe(
      "1788307200", // 2026-09-02T00:00:00Z: five days before the last sync
    );
  });

  it("refuses when the daily budget would be exceeded", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    const { fetchFn, calls } = fakeFetch(() => json({ accounts: [] }));
    // Manual syncs a minute apart, all within the same UTC day.
    for (let i = 0; i < 20; i++) {
      const t = new Date(NOW.getTime() + i * 60_000);
      expect(
        await runSync(db, fetchFn, { now: t, automatic: false }),
      ).toMatchObject({ ok: true });
    }
    expect(calls).toHaveLength(20);
    expect(
      await runSync(db, fetchFn, {
        now: new Date(NOW.getTime() + 20 * 60_000),
        automatic: false,
      }),
    ).toEqual({
      ok: false,
      error: "Daily SimpleFIN request limit reached (20); try again tomorrow.",
    });
    expect(calls).toHaveLength(20);
  });

  it("maps 403 to the reconnect message, still counting the request, and keeps last sync", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    const { fetchFn } = fakeFetch(() => new Response("", { status: 403 }));
    expect(await runSync(db, fetchFn, { now: NOW, automatic: false })).toEqual({
      ok: false,
      error: REJECTED_ERROR,
    });
    expect(getConnection(db, NOW)).toMatchObject({
      lastSyncAt: null,
      requestsToday: 1,
    });
    const down = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(
      await runSync(db, down.fetchFn, { now: NOW, automatic: false }),
    ).toEqual({
      ok: false,
      error: "Couldn't reach SimpleFIN.",
    });
    // A request that never reached the bridge is not charged.
    expect(getConnection(db, NOW).requestsToday).toBe(1);
  });

  it("passes payload errors through as warnings", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    const { fetchFn } = fakeFetch(() =>
      json({ errors: ["Bank X needs re-authentication"], accounts: [] }),
    );
    expect(await runSync(db, fetchFn, { now: NOW, automatic: false })).toEqual({
      ok: true,
      results: [],
      warnings: ["Bank X needs re-authentication"],
      requests: 1,
    });
    // Kept, so an automatic sync's warnings still reach Home and Settings.
    expect(getConnection(db, NOW).warnings).toEqual([
      "Bank X needs re-authentication",
    ]);
  });

  it("replaces the kept warnings on the next sync, even when there are none", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    let errors = ["Bank X needs re-authentication"];
    const { fetchFn } = fakeFetch(() => json({ errors, accounts: [] }));
    await runSync(db, fetchFn, { now: NOW, automatic: true });
    errors = [];
    const later = new Date(NOW.getTime() + 60 * 60_000);
    expect(
      await runSync(db, fetchFn, { now: later, automatic: true }),
    ).toMatchObject({ ok: true });
    expect(getConnection(db, later).warnings).toEqual([]);
  });

  it("keeps the last sync's warnings when a sync fails or loads older history", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    const warn = fakeFetch(() =>
      json({ errors: ["Bank X needs re-authentication"], accounts: [] }),
    );
    await runSync(db, warn.fetchFn, { now: NOW, automatic: false });
    const fail = fakeFetch(() => new Response("", { status: 503 }));
    await runSync(db, fail.fetchFn, { now: NOW, automatic: false });
    const empty = fakeFetch(() => json({ accounts: [] }));
    await runSync(db, empty.fetchFn, {
      now: NOW,
      automatic: false,
      olderHistory: true,
    });
    expect(getConnection(db, NOW).warnings).toEqual([
      "Bank X needs re-authentication",
    ]);
  });

  it("stamps every attempt and keeps the error until a sync succeeds", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    const fail = fakeFetch(() => new Response("", { status: 503 }));
    expect(
      await runSync(db, fail.fetchFn, { now: NOW, automatic: false }),
    ).toEqual({ ok: false, error: "SimpleFIN returned 503." });
    expect(getLastAttemptAt(db)).toBe(NOW.toISOString());
    expect(getConnection(db, NOW)).toMatchObject({
      lastSyncAt: null,
      lastError: "SimpleFIN returned 503.",
      shouldAutoSync: false,
    });

    // The automatic gate counts from that attempt, not from a success there
    // never was, so a bank that is down is not retried every page load.
    const soon = new Date(NOW.getTime() + 10 * 60_000);
    expect(
      await runSync(db, fail.fetchFn, { now: soon, automatic: true }),
    ).toEqual({ ok: false, error: "Synced less than 30 minutes ago." });
    expect(fail.calls).toHaveLength(1);
    // A refusal by the budget is not a fault: it leaves the error as it was.
    expect(getConnection(db, soon).lastError).toBe("SimpleFIN returned 503.");

    const ok = fakeFetch(() => json({ accounts: [] }));
    expect(
      await runSync(db, ok.fetchFn, { now: soon, automatic: false }),
    ).toMatchObject({ ok: true });
    expect(getConnection(db, soon).lastError).toBeNull();
  });

  it("answers a broken sync flatly, with none of the access URL in it", async () => {
    const { fetchFn, calls } = fakeFetch(() => json({ accounts: [] }));
    const broken = {
      select: () => {
        throw new Error(`disk I/O error opening ${ACCESS}`);
      },
    } as unknown as ReturnType<typeof openDb>;
    const out = await runSync(broken, fetchFn, { now: NOW, automatic: false });
    expect(out).toEqual({ ok: false, error: SYNC_FAILED_ERROR });
    expect(JSON.stringify(out)).not.toContain("sfin.test");
    expect(calls).toHaveLength(0);
  });

  it("plainReason keeps a reason readable without leaking a URL", () => {
    expect(plainReason(new Error(`FK failed at ${ACCESS}/accounts?x=1`))).toBe(
      "FK failed at …",
    );
    expect(plainReason(new Error(["a", "  b"].join("\n")))).toBe("a b");
    expect(plainReason(new Error(""))).toBe("unknown error");
  });

  it("olderHistory fetches the 90 days before the earliest synced date and leaves last sync alone", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    const { fetchFn, calls } = fakeFetch(() =>
      json({
        accounts: [account("ACT-1", [txn("t1", "2026-07-15", "-1.00", "OLD")])],
      }),
    );
    await runSync(db, fetchFn, { now: NOW, automatic: false });
    const out = await runSync(db, fetchFn, {
      now: LATER,
      automatic: false,
      olderHistory: true,
    });
    expect(out).toMatchObject({ ok: true, requests: 1 });
    // 2026-07-16T00:00Z is the exclusive end; one window earlier is the start.
    const end = Date.UTC(2026, 6, 16) / 1000;
    expect(calls[1].url).toBe(
      `https://sfin.test/simplefin/accounts?start-date=${end - 89 * DAY}&end-date=${end}&pending=1`,
    );
    expect(getConnection(db, LATER).lastSyncAt).toBe(NOW.toISOString());
    expect(getHistoryFloor(db)).toBe("2026-04-18");
  });

  it("says so when there is no older history, and steps back again next time", async () => {
    const { db } = seed();
    setAccessUrl(db, ACCESS, NOW);
    const { fetchFn, calls } = fakeFetch((_call, n) =>
      json({
        accounts: [
          account(
            "ACT-1",
            n === 1 ? [txn("t1", "2026-07-15", "-1.00", "OLD")] : [],
          ),
        ],
      }),
    );
    await runSync(db, fetchFn, { now: NOW, automatic: false });

    const first = await runSync(db, fetchFn, {
      now: LATER,
      automatic: false,
      olderHistory: true,
    });
    expect(first).toMatchObject({
      ok: true,
      warnings: [NO_OLDER_WARNING],
      requests: 1,
    });
    // The window reached 2026-04-18; the floor remembers it even though the
    // bank sent nothing back to move `earliestSynced`.
    expect(getHistoryFloor(db)).toBe("2026-04-18");

    const second = await runSync(db, fetchFn, {
      now: LATER,
      automatic: false,
      olderHistory: true,
    });
    expect(second).toMatchObject({ ok: true, warnings: [NO_OLDER_WARNING] });
    // 2026-04-19T00:00Z is the exclusive end; one window earlier is the start.
    expect(calls[2].url).toBe(
      `https://sfin.test/simplefin/accounts?start-date=1768867200&end-date=1776556800&pending=1`,
    );
    expect(getHistoryFloor(db)).toBe("2026-01-20");
    // An empty older window is a fact about the bank, not a failure.
    expect(getConnection(db, LATER).lastError).toBeNull();
  });
});
