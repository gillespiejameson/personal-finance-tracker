import { describe, expect, it } from "vitest";
import { cashFlowHistory, waterfallSteps } from "@/lib/insights/cashflow";
import type { Line } from "@/lib/insights/lines";

const line = (
  month: string,
  amountCents: number,
  kind: Line["parentKind"],
  isFixed = false,
  seedKey: string | null = null,
): Line => ({
  txnId: Math.random(),
  date: `${month}-05`,
  month,
  amountCents,
  merchant: "m",
  accountId: 1,
  categoryId: 1,
  leafName: "x",
  leafSeedKey: seedKey,
  isFixed,
  parentId: 1,
  parentName: "P",
  parentSeedKey: null,
  parentKind: kind,
  color: "#000000",
});

describe("cash flow", () => {
  it("builds one row per month in order with zeros for empty months", () => {
    const lines = [
      line("2026-07", 400000, "income"),
      line("2026-07", -150000, "expense", true),
      line("2026-07", -30000, "expense"),
      line("2026-07", -20000, "expense", true, "savings/savings-investing"),
    ];
    const rows = cashFlowHistory(lines, ["2026-06", "2026-07"]);
    expect(rows[0]).toEqual({
      month: "2026-06",
      income: 0,
      fixed: 0,
      variable: 0,
      savings: 0,
      spent: 0,
      leftover: 0,
    });
    expect(rows[1]).toEqual({
      month: "2026-07",
      income: 400000,
      fixed: 150000,
      variable: 30000,
      savings: 20000,
      spent: 180000,
      leftover: 200000,
    });
  });
  it("waterfall steps chain start/end and finish at leftover", () => {
    const steps = waterfallSteps({
      income: 400000,
      fixed: 150000,
      variable: 30000,
      savings: 20000,
      spent: 180000,
      leftover: 200000,
    });
    expect(steps.map((s) => s.label)).toEqual([
      "Income",
      "Fixed",
      "Variable",
      "Savings",
      "Leftover",
    ]);
    expect(steps[0]).toEqual({
      label: "Income",
      delta: 400000,
      start: 0,
      end: 400000,
    });
    expect(steps[1]).toEqual({
      label: "Fixed",
      delta: -150000,
      start: 400000,
      end: 250000,
    });
    expect(steps[4]).toEqual({
      label: "Leftover",
      delta: 200000,
      start: 0,
      end: 200000,
    });
  });
});
