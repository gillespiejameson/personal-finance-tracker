import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { updateAccountRecord } from "@/lib/accounts/update";
import { openDb } from "@/lib/db/client";
import { accounts, balanceSnapshots } from "@/lib/db/schema";

function seed(type: "checking" | "credit" | "loan" | "savings") {
  const db = openDb(":memory:");
  const [a] = db
    .insert(accounts)
    .values({ name: "A", type, aprBps: 2499, minPaymentCents: 3500 })
    .returning()
    .all();
  db.insert(balanceSnapshots)
    .values([
      { accountId: a.id, date: "2026-03-01", balanceCents: -187412 },
      { accountId: a.id, date: "2026-03-02", balanceCents: -200000 },
    ])
    .run();
  return { db, a };
}
const snaps = (db: ReturnType<typeof openDb>, id: number) =>
  db
    .select({ c: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.accountId, id))
    .orderBy(balanceSnapshots.date)
    .all()
    .map((s) => s.c);
const base = {
  name: "Renamed",
  institution: "Bank",
  color: "#007AFF",
} as const;

describe("updateAccountRecord", () => {
  it("updates the four editable fields and keeps debt terms", () => {
    const { db, a } = seed("credit");
    expect(updateAccountRecord(db, a.id, { ...base, type: "credit" })).toEqual({
      ok: true,
    });
    const row = db.select().from(accounts).where(eq(accounts.id, a.id)).get();
    expect(row).toMatchObject({
      name: "Renamed",
      institution: "Bank",
      color: "#007AFF",
      type: "credit",
      aprBps: 2499,
      minPaymentCents: 3500,
    });
  });

  it("negates snapshots when an asset becomes a liability", () => {
    const { db, a } = seed("checking");
    updateAccountRecord(db, a.id, { ...base, type: "credit" });
    expect(snaps(db, a.id)).toEqual([187412, 200000]);
  });

  it("negates snapshots when a liability becomes an asset", () => {
    const { db, a } = seed("credit");
    updateAccountRecord(db, a.id, { ...base, type: "checking" });
    expect(snaps(db, a.id)).toEqual([187412, 200000]);
  });

  it("leaves snapshots alone within the same kind", () => {
    const { db, a } = seed("credit");
    updateAccountRecord(db, a.id, { ...base, type: "loan" });
    expect(snaps(db, a.id)).toEqual([-187412, -200000]);
    const s = seed("checking");
    updateAccountRecord(s.db, s.a.id, { ...base, type: "savings" });
    expect(snaps(s.db, s.a.id)).toEqual([-187412, -200000]);
  });

  it("does not touch other accounts' snapshots", () => {
    const { db, a } = seed("checking");
    const [b] = db
      .insert(accounts)
      .values({ name: "B", type: "checking" })
      .returning()
      .all();
    db.insert(balanceSnapshots)
      .values({ accountId: b.id, date: "2026-03-01", balanceCents: 100 })
      .run();
    updateAccountRecord(db, a.id, { ...base, type: "credit" });
    expect(snaps(db, b.id)).toEqual([100]);
  });

  it("reports a missing account", () => {
    const { db } = seed("checking");
    expect(updateAccountRecord(db, 999, { ...base, type: "checking" })).toEqual(
      {
        ok: false,
        error: "Account not found.",
      },
    );
  });
});
