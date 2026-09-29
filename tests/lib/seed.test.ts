import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { accounts, transactions, transferPairs } from "@/lib/db/schema";
import { seed } from "@/lib/seed";
import { mustFind } from "../helpers";

describe("seed", () => {
  it("is deterministic and produces transfers, a refund, and enough rows", () => {
    const a = openDb(":memory:");
    const b = openDb(":memory:");
    const ra = seed(a, { months: 3, seedValue: 7, endDate: "2026-09-05" });
    const rb = seed(b, { months: 3, seedValue: 7, endDate: "2026-09-05" });
    expect(ra).toEqual(rb);
    expect(a.select().from(accounts).all()).toHaveLength(4);
    const txns = a.select().from(transactions).all();
    expect(txns.length).toBeGreaterThan(120);
    expect(a.select().from(transferPairs).all().length).toBeGreaterThanOrEqual(
      4,
    ); // Jul+Aug savings transfers and card payments (Sep 6/25 are after endDate)
    expect(
      txns.some(
        (t) => t.amountCents === 2345 && t.rawDescription.includes("AMAZON"),
      ),
    ).toBe(true);
    expect(new Set(txns.map((t) => t.dedupeHash)).size).toBe(txns.length);
  });

  it("keeps rent as spending, stores clean descriptions, and reconciles card payments", () => {
    const db = openDb(":memory:");
    seed(db, { months: 3, seedValue: 7, endDate: "2026-09-05" });
    const txns = db.select().from(transactions).all();
    const rent = txns.filter((t) =>
      t.rawDescription.includes("GREENWOOD PROPERTIES RENT"),
    );
    expect(rent.length).toBeGreaterThanOrEqual(2);
    expect(rent.every((t) => !t.isTransfer)).toBe(true);
    expect(
      txns.some(
        (t) =>
          /\s\d$/.test(t.rawDescription) &&
          !/#\d+$/.test(t.rawDescription) &&
          /^(TARGET|KROGER|AMAZON|STARBUCKS)/.test(t.rawDescription),
      ),
    ).toBe(false);
    // Every card payment equals the card's net charges since the previous payment.
    // Sort by id (insertion/generation order), not date: a payment posts 2 days after
    // the balance snapshot it pays off, so a purchase made on the payment's *own*
    // calendar day (but generated, and added to the balance, after the snapshot) can
    // share or precede that date. id strictly follows the seed's generation order and
    // therefore the true order in which cardBalance was mutated, so it is the reliable
    // sort key here even though `date` is not.
    const cardId = mustFind(
      db.select().from(accounts).all(),
      (a) => a.name === "Sapphire",
      "the Sapphire account",
    ).id;
    const card = txns
      .filter((t) => t.accountId === cardId)
      .sort((a, b) => a.id - b.id);
    let running = 0;
    for (const t of card) {
      if (t.rawDescription.startsWith("Payment Thank You")) {
        expect(t.amountCents).toBe(running);
        running = 0;
      } else running += -t.amountCents;
    }
    // Order-independent guard: total paid == net card charges dated on/before the last payment cutoff (the 25th).
    const chkId = mustFind(
      db.select().from(accounts).all(),
      (a) => a.name === "Chase Checking",
      "the Chase Checking account",
    ).id;
    const autopays = txns
      .filter(
        (t) =>
          t.accountId === chkId &&
          t.rawDescription === "CHASE CREDIT CRD AUTOPAY",
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    expect(autopays.length).toBeGreaterThanOrEqual(2);
    const cutoff = autopays[autopays.length - 1].date; // the 25th of the last paid month
    const charges = card.filter(
      (t) =>
        !t.rawDescription.startsWith("Payment Thank You") && t.date < cutoff,
    );
    const totalCharged = charges.reduce((s, t) => s + -t.amountCents, 0);
    const totalPaid = autopays.reduce((s, t) => s + -t.amountCents, 0);
    expect(totalPaid).toBe(totalCharged);
    // and the Costco row must be inside a paid period
    const costco = mustFind(
      card,
      (t) => t.rawDescription.startsWith("COSTCO WHSE #1021 SPLIT ME"),
      "the Costco row",
    );
    expect(costco.date <= cutoff).toBe(true);
  });
});
