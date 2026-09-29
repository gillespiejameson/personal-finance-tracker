import { describe, expect, it } from "vitest";
import { loadAlerts } from "@/lib/anomalies/load";
import { loadBudgetPage } from "@/lib/budget/load";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { openDb } from "@/lib/db/client";
import { accounts, recurring, transactions } from "@/lib/db/schema";
import { loadLines } from "@/lib/insights/lines";
import { listBills } from "@/lib/recurring/refresh";

const TODAY = "2026-09-08";
const MONTH = "2026-09";

/** A database with enough history for the budget gate and a live bill row. */
function seed() {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  const [account] = db
    .insert(accounts)
    .values({ name: "Chk", type: "checking" })
    .returning()
    .all();
  const categoryId = findCategoryId(db, "Groceries") as number;
  const rows = [];
  for (const month of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
    for (let i = 0; i < 25; i++) {
      rows.push({
        accountId: account.id,
        date: `${month}-${String(1 + (i % 28)).padStart(2, "0")}`,
        amountCents: -1000 - i,
        rawDescription: "Store",
        merchant: "Store",
        dedupeHash: `${month}-${i}`,
        categoryId,
      });
    }
  }
  db.insert(transactions).values(rows).run();
  db.insert(recurring)
    .values({
      merchant: "Utility",
      cadence: "monthly",
      occurrences: 4,
      firstSeen: "2026-05-12",
      categoryId,
      avgCents: -8500,
      intervalDays: 30,
      toleranceCents: 500,
      lastSeen: "2026-08-12",
      nextExpected: "2026-09-12",
      amountKey: -85,
    })
    .run();
  return db;
}

describe("pre-loaded lines and bills", () => {
  it("loadBudgetPage returns the same page with or without pre", () => {
    const db = seed();
    expect(
      loadBudgetPage(db, TODAY, MONTH, {
        lines: loadLines(db),
        bills: listBills(db, { today: TODAY }).bills,
      }),
    ).toEqual(loadBudgetPage(db, TODAY, MONTH));
  });

  it("loadBudgetPage with a partial pre still loads the rest", () => {
    const db = seed();
    expect(loadBudgetPage(db, TODAY, MONTH, { lines: loadLines(db) })).toEqual(
      loadBudgetPage(db, TODAY, MONTH),
    );
    expect(
      loadBudgetPage(db, TODAY, MONTH, {
        bills: listBills(db, { today: TODAY }).bills,
      }),
    ).toEqual(loadBudgetPage(db, TODAY, MONTH));
  });

  it("loadAlerts returns the same page with or without pre", () => {
    const db = seed();
    const pre = {
      lines: loadLines(db),
      bills: listBills(db, { today: TODAY }).bills,
    };
    expect(loadAlerts(db, TODAY, {}, pre)).toEqual(loadAlerts(db, TODAY));
    expect(loadAlerts(db, TODAY, { includeDismissed: true }, pre)).toEqual(
      loadAlerts(db, TODAY, { includeDismissed: true }),
    );
  });
});
