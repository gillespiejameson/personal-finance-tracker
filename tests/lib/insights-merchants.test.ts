import { describe, expect, it } from "vitest";
import type { Line } from "@/lib/insights/lines";
import { merchantPhrase, topMerchants } from "@/lib/insights/merchants";

let nextTxnId = 1;
const line = (
  merchant: string,
  amountCents: number,
  month = "2026-07",
  kind: Line["parentKind"] = "expense",
  txnId?: number,
): Line => ({
  txnId: txnId ?? nextTxnId++,
  date: `${month}-10`,
  month,
  amountCents,
  merchant,
  accountId: 1,
  categoryId: 1,
  leafName: "x",
  leafSeedKey: null,
  isFixed: false,
  parentId: 1,
  parentName: "Food",
  parentSeedKey: null,
  parentKind: kind,
  color: "#000000",
});

describe("topMerchants", () => {
  const lines = [
    line("DoorDash", -2000),
    line("DoorDash", -1500),
    line("DoorDash", 500),
    line("H-E-B", -9000),
    line("Acme Payroll", 400000, "2026-07", "income"),
    line("Old", -99999, "2026-06"),
  ];
  it("ranks by dollars and by count over spend lines of the month", () => {
    expect(
      topMerchants(lines, "2026-07", "dollars").map((m) => m.merchant),
    ).toEqual(["H-E-B", "DoorDash"]);
    expect(
      topMerchants(lines, "2026-07", "count").map((m) => m.merchant),
    ).toEqual(["DoorDash", "H-E-B"]);
    const dd = topMerchants(lines, "2026-07", "count")[0];
    expect(dd).toMatchObject({
      totalCents: 3000,
      count: 3,
      phrase: "$30.00 at DoorDash across 3 purchases",
    });
  });
  it("counts a split transaction once, not once per split line", () => {
    const splitTxnId = 9001;
    const splitLines = [
      line("Costco", -15000, "2026-07", "expense", splitTxnId),
      line("Costco", -6000, "2026-07", "expense", splitTxnId),
    ];
    const stat = topMerchants(splitLines, "2026-07", "dollars")[0];
    expect(stat).toMatchObject({
      merchant: "Costco",
      totalCents: 21000,
      count: 1,
    });
  });
  it("phrases singular and plural", () => {
    expect(merchantPhrase(1234, "Shop", 1)).toBe(
      "$12.34 at Shop across 1 purchase",
    );
    expect(merchantPhrase(100, "Shop", 2)).toBe(
      "$1.00 at Shop across 2 purchases",
    );
  });
});
