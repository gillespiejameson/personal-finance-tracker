import { describe, expect, it } from "vitest";
import { monthTotalsThrough } from "@/lib/insights/aggregate";
import type { Line } from "@/lib/insights/lines";
import { buildInsightsPage } from "@/lib/insights/page";

const line = (
  month: string,
  day: number,
  amountCents: number,
  merchant: string,
  kind: Line["parentKind"] = "expense",
): Line => ({
  txnId: month.charCodeAt(6) * 100 + day,
  date: `${month}-${String(day).padStart(2, "0")}`,
  month,
  amountCents,
  merchant,
  accountId: 1,
  categoryId: 1,
  leafName: "Groceries",
  leafSeedKey: null,
  isFixed: false,
  parentId: 2,
  parentName: "Food",
  parentSeedKey: null,
  parentKind: kind,
  color: "#FF9500",
});

describe("buildInsightsPage", () => {
  it("assembles months, averages over complete data months, history and top merchants", () => {
    const lines: Line[] = [];
    for (const m of ["2026-05", "2026-06", "2026-07", "2026-08"])
      for (let d = 1; d <= 22; d++)
        lines.push(line(m, d, -1000, d % 2 ? "H-E-B" : "Sprouts"));
    lines.push(line("2026-08", 1, 400000, "Acme Payroll", "income"));
    const page = buildInsightsPage(lines, "2026-08", "2026-08-20");
    expect(page.months).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(page.avgWindow).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(page.totals.variable).toBe(22000);
    expect(page.totals.income).toBe(400000);
    // August is the current month, so July is cut at the 20th to match it.
    expect(page.lastTotals.variable).toBe(20000);
    expect(page.partialComparison).toBe(true);
    expect(page.avgMonths).toBe(3);
    expect(page.history.map((h) => h.month)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    expect(page.history[0].spent).toBe(0);
    expect(page.waterfall[0]).toMatchObject({ label: "Income", delta: 400000 });
    expect(page.topByDollars[0]).toMatchObject({
      merchant: "H-E-B",
      totalCents: 11000,
      count: 11,
    });
    expect(page.breakdown[0]).toMatchObject({
      name: "Food",
      thisMonth: 22000,
      avg: 22000,
      avgMonths: 3,
    });
  });
  it("uses fewer months when fewer are complete and always includes the selected month", () => {
    const lines: Line[] = [];
    for (let d = 1; d <= 22; d++)
      lines.push(line("2026-07", d, -1000, "H-E-B"));
    const page = buildInsightsPage(lines, "2026-09", "2026-09-06");
    expect(page.months).toEqual(["2026-07", "2026-09"]);
    expect(page.avgWindow).toEqual(["2026-07"]);
    expect(page.breakdown[0]?.avgMonths ?? 0).toBeLessThanOrEqual(1);
  });
  it("widens the average window to the months asked for, capped by what is complete", () => {
    const lines: Line[] = [];
    for (const m of [
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ])
      for (let d = 1; d <= 22; d++) lines.push(line(m, d, -1000, "H-E-B"));
    const three = buildInsightsPage(lines, "2026-09", "2026-09-20");
    expect(three.avgMonths).toBe(3);
    expect(three.avgWindow).toEqual(["2026-06", "2026-07", "2026-08"]);
    const six = buildInsightsPage(lines, "2026-09", "2026-09-20", {
      avgMonths: 6,
    });
    expect(six.avgMonths).toBe(6);
    expect(six.avgWindow).toHaveLength(6);
    expect(six.avgWindow[0]).toBe("2026-03");
    expect(six.breakdown[0]).toMatchObject({ name: "Food", avgMonths: 6 });
    const twelve = buildInsightsPage(lines, "2026-09", "2026-09-20", {
      avgMonths: 12,
    });
    // Only six complete months exist; the selection still reads 12.
    expect(twelve.avgMonths).toBe(12);
    expect(twelve.avgWindow).toHaveLength(6);
  });
  it("compares the current month with the same stretch of the month before, and a past month with the whole of it", () => {
    const lines: Line[] = [];
    for (const m of ["2026-07", "2026-08"]) {
      for (let d = 1; d <= 22; d++) lines.push(line(m, d, -1000, "H-E-B"));
      lines.push(line(m, 25, -50000, "Realty"));
    }
    const current = buildInsightsPage(lines, "2026-09", "2026-09-10");
    expect(current.partialComparison).toBe(true);
    expect(current.lastTotals).toEqual(
      monthTotalsThrough(lines, "2026-08", 10),
    );
    expect(current.lastTotals.variable).toBe(10000);
    const past = buildInsightsPage(lines, "2026-08", "2026-09-10");
    expect(past.partialComparison).toBe(false);
    expect(past.lastTotals.variable).toBe(22000 + 50000);
  });
});
