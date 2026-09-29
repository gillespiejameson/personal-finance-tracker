import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { addDays } from "@/lib/dates";
import { openDb } from "@/lib/db/client";
import { accounts, recurring, transactions } from "@/lib/db/schema";
import {
  advanceManual,
  listBills,
  markAsBill,
  refreshRecurring,
  removeManualBill,
} from "@/lib/recurring/refresh";
import { mustFind } from "../helpers";

function seed() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  const [a] = db
    .insert(accounts)
    .values({ name: "Chk", type: "checking" })
    .returning()
    .all();
  const ins = findCategoryId(db, "Insurance") as number;
  const pay = findCategoryId(db, "Paycheck") as number;
  const rows: {
    date: string;
    amountCents: number;
    merchant: string;
    categoryId?: number;
  }[] = [];
  let d = "2026-06-12";
  for (let i = 0; i < 3; i++) {
    rows.push({
      date: d,
      amountCents: -31257,
      merchant: "Geico",
      categoryId: ins,
    });
    d = addDays(d, 28);
  }
  d = "2026-06-05";
  for (let i = 0; i < 6; i++) {
    rows.push({
      date: d,
      amountCents: 248312,
      merchant: "Acme Payroll",
      categoryId: pay,
    });
    d = addDays(d, 14);
  }
  d = "2026-06-01";
  for (let i = 0; i < 10; i++) {
    rows.push({ date: d, amountCents: -450, merchant: "Dutch Bros" });
    d = addDays(d, 2);
  }
  db.insert(transactions)
    .values(
      rows.map((r, i) => ({
        accountId: a.id,
        rawDescription: r.merchant,
        dedupeHash: `r${i}`,
        ...r,
      })),
    )
    .run();
  return { db, a };
}

describe("refreshRecurring / listBills", () => {
  it("detects bills and income, keeps dismissed flags, removes stale rows", () => {
    const { db, a } = seed();
    const today = "2026-08-20";
    const first = refreshRecurring(db, { today });
    expect(first).toEqual({ detected: 2, likely: 0, added: 2, removed: 0 });
    const { bills, monthlyTotalCents, expectedIncomeMonthlyCents } = listBills(
      db,
      { today },
    );
    const geico = mustFind(bills, (b) => b.merchant === "Geico");
    expect(geico).toMatchObject({
      cadence: "monthly",
      categoryName: "Insurance",
      isIncome: false,
      monthlyCents: 31257,
      occurrences: 3,
      isNew: false,
      confidence: "confirmed",
      manual: false,
    });
    expect(geico.recentAmounts).toEqual([-31257, -31257, -31257]);
    expect(
      db.select().from(recurring).where(eq(recurring.id, geico.id)).get()
        ?.amountKey,
    ).toBe(-31300);
    expect(geico.dueInDays).toBe(15); // 06-12 → 07-10 → 08-07, gap 28 → next 2026-09-04, 15 days after 2026-08-20
    const payroll = mustFind(bills, (b) => b.merchant === "Acme Payroll");
    expect(payroll).toMatchObject({ cadence: "biweekly", isIncome: true });
    expect(bills.some((b) => b.merchant === "Dutch Bros")).toBe(false);
    expect(monthlyTotalCents).toBe(31257);
    expect(expectedIncomeMonthlyCents).toBe(Math.round((248312 * 26) / 12));

    // dismiss Geico, refresh: flag survives
    db.update(recurring)
      .set({ dismissed: true })
      .where(eq(recurring.id, geico.id))
      .run();
    refreshRecurring(db, { today });
    expect(
      listBills(db, { today }).bills.some((b) => b.merchant === "Geico"),
    ).toBe(false);
    expect(
      mustFind(
        listBills(db, { today, includeDismissed: true }).bills,
        (b) => b.merchant === "Geico",
      ).dismissed,
    ).toBe(true);

    // remove the payroll rows: its recurring row is deleted on refresh
    db.delete(transactions)
      .where(eq(transactions.merchant, "Acme Payroll"))
      .run();
    expect(refreshRecurring(db, { today })).toMatchObject({
      detected: 1,
      added: 0,
      removed: 1,
    });
    expect(a.id).toBeTypeOf("number");
  });

  it("keeps separate rows for a merchant that is both a bill and an income source", () => {
    const db = openDb(":memory:");
    ensureDefaultCategories(db);
    const [a] = db
      .insert(accounts)
      .values({ name: "Chk", type: "checking" })
      .returning()
      .all();
    const pay = findCategoryId(db, "Paycheck") as number;
    const sub = findCategoryId(db, "Subscriptions") as number;
    const rows: {
      date: string;
      amountCents: number;
      merchant: string;
      categoryId: number;
    }[] = [];
    let d = "2026-06-01";
    for (let i = 0; i < 4; i++) {
      rows.push({
        date: d,
        amountCents: -1500,
        merchant: "Acme",
        categoryId: sub,
      });
      rows.push({
        date: addDays(d, 3),
        amountCents: 200000,
        merchant: "Acme",
        categoryId: pay,
      });
      d = addDays(d, 30);
    }
    db.insert(transactions)
      .values(
        rows.map((r, i) => ({
          accountId: a.id,
          rawDescription: r.merchant,
          dedupeHash: `b${i}`,
          ...r,
        })),
      )
      .run();
    const today = "2026-09-06";
    expect(refreshRecurring(db, { today }).detected).toBe(2);
    expect(refreshRecurring(db, { today })).toMatchObject({
      detected: 2,
      added: 0,
      removed: 0,
    });
    const bills = listBills(db, { today }).bills.filter(
      (b) => b.merchant === "Acme",
    );
    expect(bills).toHaveLength(2);
    const income = mustFind(bills, (b) => b.isIncome);
    const expense = mustFind(bills, (b) => !b.isIncome);
    expect(income.recentAmounts.every((x) => x > 0)).toBe(true);
    expect(expense.recentAmounts.every((x) => x < 0)).toBe(true);
  });
});

type SeedRow = {
  date: string;
  amountCents: number;
  merchant: string;
  categoryId?: number;
  isTransfer?: boolean;
};

function fresh() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  const [a] = db
    .insert(accounts)
    .values({ name: "Chk", type: "checking" })
    .returning()
    .all();
  let n = 0;
  const insert = (rows: SeedRow[]) =>
    db
      .insert(transactions)
      .values(
        rows.map((r) => ({
          accountId: a.id,
          rawDescription: r.merchant,
          dedupeHash: `f${n++}`,
          ...r,
        })),
      )
      .returning({ id: transactions.id })
      .all()
      .map((x) => x.id);
  const monthly = (
    merchant: string,
    start: string,
    amounts: number[],
    categoryId?: number,
  ): SeedRow[] =>
    amounts.map((amountCents, i) => ({
      date: addDays(start, 30 * i),
      amountCents,
      merchant,
      categoryId,
    }));
  return { db, insert, monthly };
}

describe("refreshRecurring: clusters, tolerance and likely pairs", () => {
  it("keys rows by amount cluster and matches them on re-run", () => {
    const { db, insert, monthly } = fresh();
    insert([
      ...monthly("Amazon", "2026-05-01", [-1500, -1500, -1500, -1500]),
      ...monthly("Amazon", "2026-05-15", [-6000, -6000, -6000, -6000]),
    ]);
    const today = "2026-08-20";
    expect(refreshRecurring(db, { today })).toEqual({
      detected: 2,
      likely: 0,
      added: 2,
      removed: 0,
    });
    const rows = db.select().from(recurring).all();
    expect(
      rows.map((r) => r.amountKey).sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([-6000, -1500]);
    // The $15 charge drifts a little; the row is updated in place, not duplicated.
    insert([{ date: "2026-08-29", amountCents: -1599, merchant: "Amazon" }]);
    expect(refreshRecurring(db, { today })).toEqual({
      detected: 2,
      likely: 0,
      added: 0,
      removed: 0,
    });
    const small = mustFind(
      db.select().from(recurring).all(),
      (r) => (r.amountKey ?? 0) > -3000,
    );
    expect(small).toMatchObject({ occurrences: 5, lastSeen: "2026-08-29" });
    expect(
      listBills(db, { today }).bills.filter((b) => b.merchant === "Amazon"),
    ).toHaveLength(2);
  });

  it("adopts a legacy row without an amount key instead of adding a second one", () => {
    const { db, insert, monthly } = fresh();
    insert(monthly("Geico", "2026-06-12", [-31257, -31257, -31257]));
    db.insert(recurring)
      .values({
        merchant: "Geico",
        cadence: "monthly",
        occurrences: 2,
        avgCents: -31257,
        intervalDays: 30,
        lastSeen: "2026-07-12",
        nextExpected: "2026-08-11",
        dismissed: true,
      })
      .run();
    expect(refreshRecurring(db, { today: "2026-08-20" })).toMatchObject({
      added: 0,
      removed: 0,
    });
    const rows = db.select().from(recurring).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amountKey: -31300,
      occurrences: 3,
      dismissed: true,
    });
  });

  it("uses the 35% tolerance only when the majority category is a fixed leaf", () => {
    const { db, insert, monthly } = fresh();
    const utilities = findCategoryId(db, "Utilities") as number;
    const groceries = findCategoryId(db, "Groceries") as number;
    const amounts = [-10000, -11500, -8500, -12800, -9600, -10400];
    insert([
      ...monthly("City Power", "2026-03-10", amounts, utilities),
      ...monthly("Corner Market", "2026-03-12", amounts, groceries),
    ]);
    const today = "2026-08-20";
    expect(refreshRecurring(db, { today })).toMatchObject({ detected: 1 });
    const bills = listBills(db, { today }).bills;
    expect(bills.map((b) => b.merchant)).toEqual(["City Power"]);
    expect(bills[0]).toMatchObject({
      occurrences: 6,
      categoryName: "Utilities",
    });
  });

  it("a dismissed row keeps its dismissal when the bill is re-keyed, and a new cluster does not inherit it", () => {
    const { db, insert, monthly } = fresh();
    insert(monthly("Geico", "2026-04-12", [-31257, -31257, -31257, -31257]));
    const today = "2026-08-20";
    refreshRecurring(db, { today });
    db.update(recurring).set({ dismissed: true }).run();
    // Re-priced well past the tolerance: the old row is replaced, not matched.
    db.update(transactions)
      .set({ amountCents: -45000 })
      .where(eq(transactions.merchant, "Geico"))
      .run();
    expect(refreshRecurring(db, { today })).toMatchObject({
      added: 1,
      removed: 1,
    });
    const rows = db.select().from(recurring).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountKey: -45000, dismissed: true });
    // A second cluster at the merchant is its own bill, not the dismissed one.
    insert(monthly("Geico", "2026-04-20", [-1500, -1500, -1500, -1500]));
    expect(refreshRecurring(db, { today })).toMatchObject({
      added: 1,
      removed: 0,
    });
    const after = db.select().from(recurring).all();
    expect(after).toHaveLength(2);
    expect(mustFind(after, (r) => r.amountKey === -45000).dismissed).toBe(true);
    expect(mustFind(after, (r) => r.amountKey === -1500).dismissed).toBe(false);
  });

  it("counts likely pairs separately and surfaces them as bills", () => {
    const { db, insert, monthly } = fresh();
    insert(monthly("Gym", "2026-07-03", [-2500, -2500]));
    const today = "2026-08-20";
    expect(refreshRecurring(db, { today })).toEqual({
      detected: 0,
      likely: 1,
      added: 1,
      removed: 0,
    });
    const gym = mustFind(
      listBills(db, { today }).bills,
      (b) => b.merchant === "Gym",
    );
    expect(gym).toMatchObject({
      confidence: "likely",
      manual: false,
      occurrences: 2,
    });
  });
});

describe("manual bills", () => {
  it("markAsBill creates a manual row that refresh keeps and advances", () => {
    const { db, insert } = fresh();
    const [txId] = insert([
      { date: "2026-07-03", amountCents: -4200, merchant: "Piano Lessons" },
    ]);
    const res = markAsBill(db, { transactionId: txId, cadence: "monthly" });
    expect(res).toMatchObject({ ok: true, created: true });
    if (!res.ok) throw new Error(res.error);
    const row = db
      .select()
      .from(recurring)
      .where(eq(recurring.id, res.id))
      .get();
    expect(row).toMatchObject({
      merchant: "Piano Lessons",
      avgCents: -4200,
      amountKey: -4200,
      intervalDays: 30,
      toleranceCents: 630,
      occurrences: 1,
      firstSeen: "2026-07-03",
      lastSeen: "2026-07-03",
      nextExpected: "2026-08-02",
      manual: true,
      confidence: "manual",
      active: true,
    });

    // A single transaction detects nothing; the manual row survives.
    const today = "2026-08-20";
    expect(refreshRecurring(db, { today })).toEqual({
      detected: 0,
      likely: 0,
      added: 0,
      removed: 0,
    });
    const bill = mustFind(
      listBills(db, { today }).bills,
      (b) => b.merchant === "Piano Lessons",
    );
    expect(bill).toMatchObject({ manual: true, confidence: "manual" });

    // A matching charge (within tolerance, case-insensitive merchant) advances
    // it; a charge outside the tolerance and a credit do not count.
    insert([
      { date: "2026-08-05", amountCents: -4500, merchant: "PIANO LESSONS" },
      { date: "2026-08-06", amountCents: -9000, merchant: "Piano Lessons" },
      { date: "2026-08-07", amountCents: 4200, merchant: "Piano Lessons" },
    ]);
    refreshRecurring(db, { today });
    expect(
      db.select().from(recurring).where(eq(recurring.id, res.id)).get(),
    ).toMatchObject({
      occurrences: 2,
      firstSeen: "2026-07-03",
      lastSeen: "2026-08-05",
      nextExpected: "2026-09-04",
      manual: true,
      confidence: "manual",
      avgCents: -4200,
    });
    // Two identical charges would otherwise be a "likely" bill: the manual
    // row stands in for that cluster instead of a duplicate being added.
    insert([
      { date: "2026-08-02", amountCents: -4200, merchant: "Piano Lessons" },
    ]);
    expect(refreshRecurring(db, { today })).toMatchObject({
      added: 0,
      removed: 0,
    });
    expect(
      db
        .select()
        .from(recurring)
        .all()
        .filter((r) => r.merchant === "Piano Lessons"),
    ).toHaveLength(1);
  });

  it("a cluster the manual row stands in for is not counted as detected", () => {
    const { db, insert, monthly } = fresh();
    const [txId] = insert(
      monthly("Piano Lessons", "2026-05-03", [-4200, -4200, -4200, -4200]),
    );
    const res = markAsBill(db, { transactionId: txId, cadence: "monthly" });
    if (!res.ok) throw new Error(res.error);
    const today = "2026-08-20";
    expect(refreshRecurring(db, { today })).toEqual({
      detected: 0,
      likely: 0,
      added: 0,
      removed: 0,
    });
    const rows = db.select().from(recurring).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: res.id,
      manual: true,
      occurrences: 4,
      lastSeen: "2026-08-01",
    });
  });

  it("advanceManual matches any amount when the tolerance is zero and leaves the row alone without matches", () => {
    const base = {
      avgCents: -4200,
      toleranceCents: 0,
      intervalDays: 14,
      firstSeen: "2026-07-03",
      lastSeen: "2026-07-03",
    };
    expect(
      advanceManual(base, [
        { date: "2026-07-03", amountCents: -4200 },
        { date: "2026-07-20", amountCents: -100 },
        { date: "2026-06-01", amountCents: -99999 },
      ]),
    ).toEqual({
      occurrences: 3,
      firstSeen: "2026-06-01",
      lastSeen: "2026-07-20",
      nextExpected: "2026-08-03",
    });
    expect(advanceManual({ ...base, toleranceCents: 100 }, [])).toBeNull();
    expect(
      advanceManual({ ...base, toleranceCents: 100 }, [
        { date: "2026-07-20", amountCents: -4301 },
        { date: "2026-07-21", amountCents: 4200 },
      ]),
    ).toBeNull();
  });

  it("a manual row without a category adopts the majority category of its matches, and never overrides one", () => {
    const { db, insert } = fresh();
    const groceries = findCategoryId(db, "Groceries") as number;
    const general = findCategoryId(db, "General") as number;
    const [txId] = insert([
      { date: "2026-05-03", amountCents: -4200, merchant: "Piano Lessons" },
    ]);
    const res = markAsBill(db, { transactionId: txId, cadence: "monthly" });
    if (!res.ok) throw new Error(res.error);
    const row = () =>
      db.select().from(recurring).where(eq(recurring.id, res.id)).get();
    expect(row()?.categoryId).toBeNull();
    insert([
      {
        date: "2026-06-02",
        amountCents: -4200,
        merchant: "Piano Lessons",
        categoryId: groceries,
      },
      {
        date: "2026-07-02",
        amountCents: -4200,
        merchant: "Piano Lessons",
        categoryId: groceries,
      },
      {
        date: "2026-08-01",
        amountCents: -4200,
        merchant: "Piano Lessons",
        categoryId: general,
      },
    ]);
    const today = "2026-08-20";
    refreshRecurring(db, { today });
    expect(row()).toMatchObject({ categoryId: groceries, occurrences: 4 });
    // Once set, the category is the row's own.
    db.update(transactions)
      .set({ categoryId: general })
      .where(eq(transactions.merchant, "Piano Lessons"))
      .run();
    refreshRecurring(db, { today });
    expect(row()?.categoryId).toBe(groceries);
    // markAsBill copies the transaction's category.
    const [tutor] = insert([
      {
        date: "2026-07-03",
        amountCents: -9900,
        merchant: "Tutor",
        categoryId: general,
      },
    ]);
    const r2 = markAsBill(db, { transactionId: tutor, cadence: "weekly" });
    if (!r2.ok) throw new Error(r2.error);
    expect(
      db.select().from(recurring).where(eq(recurring.id, r2.id)).get()
        ?.categoryId,
    ).toBe(general);
  });

  it("a bill declared on an uncategorized charge adopts the merchant's majority category on the next refresh", () => {
    const { db, insert } = fresh();
    const restaurants = findCategoryId(db, "Restaurants") as number;
    insert([
      {
        date: "2026-05-04",
        amountCents: -4200,
        merchant: "Cleaner",
        categoryId: restaurants,
      },
      {
        date: "2026-06-03",
        amountCents: -4200,
        merchant: "Cleaner",
        categoryId: restaurants,
      },
      {
        date: "2026-07-03",
        amountCents: -4200,
        merchant: "Cleaner",
        categoryId: restaurants,
      },
    ]);
    const [txId] = insert([
      { date: "2026-08-02", amountCents: -4200, merchant: "Cleaner" },
    ]);
    const res = markAsBill(db, { transactionId: txId, cadence: "monthly" });
    if (!res.ok) throw new Error(res.error);
    expect(res.created).toBe(true);
    const row = () =>
      db.select().from(recurring).where(eq(recurring.id, res.id)).get();
    // The charge it was declared on carried no category, so neither does the row.
    expect(row()?.categoryId).toBeNull();
    // What `markAsBillAction` runs straight after creating the row.
    refreshRecurring(db, { today: "2026-08-20" });
    expect(row()).toMatchObject({
      categoryId: restaurants,
      manual: true,
      occurrences: 4,
    });
  });

  it("advanceManual reports the majority category only for rows without one", () => {
    const base = {
      avgCents: -4200,
      toleranceCents: 0,
      intervalDays: 30,
      firstSeen: "2026-07-03",
      lastSeen: "2026-07-03",
    };
    const points = [
      { date: "2026-07-03", amountCents: -4200, categoryId: 5 },
      { date: "2026-08-02", amountCents: -4200, categoryId: 9 },
      { date: "2026-09-01", amountCents: -4200, categoryId: 9 },
      { date: "2026-09-30", amountCents: -4200, categoryId: null },
    ];
    expect(advanceManual({ ...base, categoryId: null }, points)).toMatchObject({
      categoryId: 9,
      occurrences: 4,
    });
    expect(
      advanceManual({ ...base, categoryId: 5 }, points),
    ).not.toHaveProperty("categoryId");
    expect(
      advanceManual({ ...base, categoryId: null }, [
        { date: "2026-07-03", amountCents: -4200 },
      ]),
    ).not.toHaveProperty("categoryId");
  });

  it("markAsBill refuses transfers and missing rows, and returns the existing row for a duplicate", () => {
    const { db, insert } = fresh();
    const [xfer, charge] = insert([
      {
        date: "2026-07-03",
        amountCents: -50000,
        merchant: "Savings",
        isTransfer: true,
      },
      { date: "2026-07-03", amountCents: -4200, merchant: "Piano Lessons" },
      { date: "2026-08-03", amountCents: -4249, merchant: "piano lessons" },
    ]);
    expect(markAsBill(db, { transactionId: xfer, cadence: "monthly" })).toEqual(
      { ok: false, error: "Transfers cannot be bills." },
    );
    expect(markAsBill(db, { transactionId: 9999, cadence: "monthly" })).toEqual(
      { ok: false, error: "Transaction not found." },
    );
    const first = markAsBill(db, { transactionId: charge, cadence: "weekly" });
    if (!first.ok) throw new Error(first.error);
    const again = markAsBill(db, {
      transactionId: charge + 1,
      cadence: "annual",
    });
    expect(again).toEqual({ ok: true, id: first.id, created: false });
    expect(db.select().from(recurring).all()).toHaveLength(1);
  });

  it("removeManualBill deletes manual rows only", () => {
    const { db, insert, monthly } = fresh();
    insert(monthly("Geico", "2026-06-12", [-31257, -31257, -31257]));
    refreshRecurring(db, { today: "2026-08-20" });
    const detected = mustFind(
      db.select().from(recurring).all(),
      (r) => !r.manual,
    );
    const [txId] = insert([
      { date: "2026-07-03", amountCents: -4200, merchant: "Piano Lessons" },
    ]);
    const res = markAsBill(db, { transactionId: txId, cadence: "quarterly" });
    if (!res.ok) throw new Error(res.error);
    expect(removeManualBill(db, detected.id)).toBe(false);
    expect(removeManualBill(db, res.id)).toBe(true);
    expect(removeManualBill(db, res.id)).toBe(false);
    expect(
      db
        .select()
        .from(recurring)
        .all()
        .map((r) => r.id),
    ).toEqual([detected.id]);
  });
});

describe("listBills: recentAmounts is the row's own cluster", () => {
  /** Weekly $987.65 and monthly $48.17 at one merchant, both detected. */
  const twoClusters = (): SeedRow[] => [
    ...[-98765, -98765, -98200, -98765, -98765, -99150, -98765, -98765].map(
      (amountCents, i) => ({
        date: addDays("2026-06-05", 7 * i),
        amountCents,
        merchant: "Acme Payroll",
      }),
    ),
    ...[-4817, -4817, -4700, -4890].map((amountCents, i) => ({
      date: addDays("2026-06-09", 30 * i),
      amountCents,
      merchant: "Acme Payroll",
    })),
  ];

  /** The same two clusters, each charged to the cent, so both tolerances are 0. */
  const exactClusters = (): SeedRow[] => [
    ...Array.from({ length: 8 }, (_, i) => ({
      date: addDays("2026-06-05", 7 * i),
      amountCents: -98765,
      merchant: "Acme Payroll",
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      date: addDays("2026-06-09", 30 * i),
      amountCents: -4817,
      merchant: "Acme Payroll",
    })),
  ];

  it("two clusters at one merchant get their own sparklines", () => {
    const { db, insert } = fresh();
    insert(twoClusters());
    const today = "2026-09-20";
    expect(refreshRecurring(db, { today }).detected).toBe(2);
    const bills = listBills(db, { today }).bills.filter(
      (b) => b.merchant === "Acme Payroll",
    );
    expect(bills).toHaveLength(2);
    const weekly = mustFind(bills, (b) => b.cadence === "weekly");
    const monthly = mustFind(bills, (b) => b.cadence === "monthly");
    expect(weekly.recentAmounts).toEqual([
      -98200, -98765, -98765, -99150, -98765, -98765,
    ]);
    expect(monthly.recentAmounts).toEqual([-4817, -4817, -4700, -4890]);
  });

  it("two exact-amount clusters at one merchant get their own sparklines", () => {
    // A detected row's tolerance of 0 means the exact amount, not any amount:
    // most real bills are charged to the cent, and their sparkline is theirs.
    const { db, insert } = fresh();
    insert(exactClusters());
    const today = "2026-09-20";
    expect(refreshRecurring(db, { today }).detected).toBe(2);
    const bills = listBills(db, { today }).bills.filter(
      (b) => b.merchant === "Acme Payroll",
    );
    expect(bills).toHaveLength(2);
    expect(
      mustFind(bills, (b) => b.cadence === "weekly").recentAmounts,
    ).toEqual(Array(6).fill(-98765));
    expect(
      mustFind(bills, (b) => b.cadence === "monthly").recentAmounts,
    ).toEqual(Array(4).fill(-4817));
  });

  it("a manual bill still shows the merchant's last six charges", () => {
    const { db, insert } = fresh();
    insert(twoClusters());
    db.insert(recurring)
      .values({
        merchant: "Acme Payroll",
        cadence: "weekly",
        intervalDays: 7,
        avgCents: -98765,
        amountKey: -98800,
        toleranceCents: 0,
        occurrences: 1,
        firstSeen: "2026-06-05",
        lastSeen: "2026-07-24",
        nextExpected: "2026-07-31",
        manual: true,
        confidence: "manual",
      })
      .run();
    const [bill] = listBills(db, { today: "2026-09-20" }).bills;
    expect(bill.manual).toBe(true);
    expect(bill.recentAmounts).toEqual([
      -4817, -99150, -98765, -98765, -4700, -4890,
    ]);
  });

  it("a manual bill with a tolerance shows only the amounts inside it", () => {
    // A manual row's tolerance of 0 means any amount, but a non-zero one is a
    // real cluster: the sparkline drops the merchant's other charges.
    const { db, insert } = fresh();
    insert(twoClusters());
    db.insert(recurring)
      .values({
        merchant: "Acme Payroll",
        cadence: "weekly",
        intervalDays: 7,
        avgCents: -98765,
        amountKey: -98800,
        toleranceCents: 500,
        occurrences: 1,
        firstSeen: "2026-06-05",
        lastSeen: "2026-07-24",
        nextExpected: "2026-07-31",
        manual: true,
        confidence: "manual",
      })
      .run();
    const [bill] = listBills(db, { today: "2026-09-20" }).bills;
    expect(bill.manual).toBe(true);
    expect(bill.recentAmounts).toEqual([
      -98765, -98765, -98765, -99150, -98765, -98765,
    ]);
  });
});
