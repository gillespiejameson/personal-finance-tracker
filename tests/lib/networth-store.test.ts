import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import {
  listSnapshots,
  recordSnapshots,
  setBalance,
} from "@/lib/networth/store";

describe("networth store", () => {
  it("upserts on (accountId, date), replacing the balance for the same date", () => {
    const db = openDb(":memory:");
    const [acct] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();

    recordSnapshots(db, acct.id, [
      { date: "2026-09-01", balanceCents: 1000 },
      { date: "2026-09-02", balanceCents: 2000 },
    ]);
    recordSnapshots(db, acct.id, [{ date: "2026-09-02", balanceCents: 2500 }]);

    expect(listSnapshots(db)).toEqual([
      { accountId: acct.id, date: "2026-09-01", balanceCents: 1000 },
      { accountId: acct.id, date: "2026-09-02", balanceCents: 2500 },
    ]);
  });

  it("keeps snapshots for different accounts independent", () => {
    const db = openDb(":memory:");
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    const [b] = db
      .insert(accounts)
      .values({ name: "Card", type: "credit" })
      .returning()
      .all();

    recordSnapshots(db, a.id, [{ date: "2026-09-01", balanceCents: 1000 }]);
    recordSnapshots(db, b.id, [{ date: "2026-09-01", balanceCents: 3000 }]);

    const rows = listSnapshots(db);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { accountId: a.id, date: "2026-09-01", balanceCents: 1000 },
        { accountId: b.id, date: "2026-09-01", balanceCents: 3000 },
      ]),
    );
  });

  it("setBalance upserts a single snapshot", () => {
    const db = openDb(":memory:");
    const [acct] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();

    setBalance(db, acct.id, "2026-09-01", 500);
    setBalance(db, acct.id, "2026-09-01", 750);

    expect(listSnapshots(db)).toEqual([
      { accountId: acct.id, date: "2026-09-01", balanceCents: 750 },
    ]);
  });
});
