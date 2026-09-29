import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import {
  getDebtExtra,
  listDebtRows,
  setDebtExtra,
  setDebtTerms,
} from "@/lib/debt/store";
import { setBalance } from "@/lib/networth/store";

describe("debt store", () => {
  it("marks a liability account ready once it has a balance and terms", () => {
    const db = openDb(":memory:");
    const [card] = db
      .insert(accounts)
      .values({ name: "Card", type: "credit" })
      .returning()
      .all();

    setBalance(db, card.id, "2026-09-01", 100000);
    let rows = listDebtRows(db, "2026-09-05");
    expect(rows).toEqual([
      {
        id: card.id,
        name: "Card",
        color: "#0A84FF",
        type: "credit",
        balanceCents: 100000,
        asOf: "2026-09-01",
        aprBps: null,
        minPaymentCents: null,
        ready: false,
        missing: "terms",
      },
    ]);

    const result = setDebtTerms(db, card.id, 2400, 5000);
    expect(result).toEqual({ ok: true });

    rows = listDebtRows(db, "2026-09-05");
    expect(rows[0]).toMatchObject({
      aprBps: 2400,
      minPaymentCents: 5000,
      ready: true,
      missing: null,
    });
  });

  it("excludes checking/savings accounts from listDebtRows", () => {
    const db = openDb(":memory:");
    db.insert(accounts).values({ name: "Chk", type: "checking" }).run();
    expect(listDebtRows(db, "2026-09-05")).toEqual([]);
  });

  it("flags a debt with both terms set but no positive balance as missing a balance", () => {
    const db = openDb(":memory:");
    const [card] = db
      .insert(accounts)
      .values({ name: "Card", type: "credit" })
      .returning()
      .all();
    setDebtTerms(db, card.id, 2400, 5000);

    let rows = listDebtRows(db, "2026-09-05");
    expect(rows[0]).toMatchObject({
      balanceCents: null,
      ready: false,
      missing: "balance",
    });

    setBalance(db, card.id, "2026-09-01", 0);
    rows = listDebtRows(db, "2026-09-05");
    expect(rows[0]).toMatchObject({
      balanceCents: 0,
      ready: false,
      missing: "balance",
    });
  });

  it("refuses to set terms on a non-liability account", () => {
    const db = openDb(":memory:");
    const [chk] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    expect(setDebtTerms(db, chk.id, 2400, 5000)).toEqual({
      ok: false,
      error: "Only credit and loan accounts can have debt terms.",
    });
  });

  it("refuses an APR above 100%", () => {
    const db = openDb(":memory:");
    const [card] = db
      .insert(accounts)
      .values({ name: "Card", type: "credit" })
      .returning()
      .all();
    expect(setDebtTerms(db, card.id, 10001, 5000)).toEqual({
      ok: false,
      error: "APR must be between 0% and 100%.",
    });
  });

  it("refuses a negative minimum payment", () => {
    const db = openDb(":memory:");
    const [card] = db
      .insert(accounts)
      .values({ name: "Card", type: "credit" })
      .returning()
      .all();
    expect(setDebtTerms(db, card.id, 2400, -1)).toEqual({
      ok: false,
      error: "Minimum payment must be zero or more.",
    });
  });

  it("round-trips the extra-per-month setting, defaulting to zero", () => {
    const db = openDb(":memory:");
    expect(getDebtExtra(db)).toBe(0);
    setDebtExtra(db, 25000);
    expect(getDebtExtra(db)).toBe(25000);
  });
});
