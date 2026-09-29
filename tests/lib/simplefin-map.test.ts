import { describe, expect, it } from "vitest";
import {
  amountToCents,
  descriptionOf,
  isPending,
  sfinDate,
  toParsedRows,
  utcDate,
} from "@/lib/simplefin/map";
import type { SfinTransaction } from "@/lib/simplefin/types";

const txn = (over: Partial<SfinTransaction> = {}): SfinTransaction => ({
  id: "t1",
  posted: 1788566400, // 2026-09-05T00:00:00Z
  amount: "-12.34",
  description: "KROGER #123",
  ...over,
});

describe("amountToCents", () => {
  it("parses plain decimals, deposits positive", () => {
    expect(amountToCents("-12.34")).toBe(-1234);
    expect(amountToCents("12.34")).toBe(1234);
    expect(amountToCents("+5")).toBe(500);
    expect(amountToCents("1234.5")).toBe(123450);
    expect(amountToCents("0.1")).toBe(10);
    expect(amountToCents("0")).toBe(0);
    expect(amountToCents(" 7.00 ")).toBe(700);
  });

  it("rounds a third decimal rather than truncating", () => {
    expect(amountToCents("1.005")).toBe(101);
    expect(amountToCents("1.004")).toBe(100);
  });

  it("rejects commas, blanks and anything non-numeric", () => {
    expect(amountToCents("1,234.56")).toBeNull();
    expect(amountToCents("")).toBeNull();
    expect(amountToCents("abc")).toBeNull();
    expect(amountToCents("NaN")).toBeNull();
    expect(amountToCents("1e3")).toBeNull();
    expect(amountToCents("$5")).toBeNull();
  });
});

describe("sfinDate", () => {
  it("uses the UTC date of posted", () => {
    expect(utcDate(1788566400)).toBe("2026-09-05");
    expect(sfinDate(txn({ posted: 1788652799 }))).toBe("2026-09-05"); // 23:59:59Z
    expect(sfinDate(txn({ posted: 1788652800 }))).toBe("2026-09-06");
  });

  it("falls back to transacted_at while pending, and throws with neither", () => {
    expect(sfinDate(txn({ posted: 0, transacted_at: 1788652800 }))).toBe(
      "2026-09-06",
    );
    expect(() => sfinDate(txn({ posted: 0 }))).toThrow(/t1/);
    expect(() => sfinDate(txn({ posted: 0, transacted_at: 0 }))).toThrow();
  });
});

describe("isPending", () => {
  it("is pending when posted is 0 or the flag is set", () => {
    expect(isPending(txn())).toBe(false);
    expect(isPending(txn({ posted: 0, transacted_at: 1 }))).toBe(true);
    expect(isPending(txn({ pending: true }))).toBe(true);
  });
});

describe("descriptionOf", () => {
  it("prefers description, falls back to payee", () => {
    expect(descriptionOf(txn())).toBe("KROGER #123");
    expect(descriptionOf(txn({ description: "  ", payee: "Kroger" }))).toBe(
      "Kroger",
    );
  });

  it("appends a memo only when it adds information", () => {
    expect(descriptionOf(txn({ memo: "Groceries" }))).toBe(
      "KROGER #123 · Groceries",
    );
    expect(descriptionOf(txn({ memo: "kroger" }))).toBe("KROGER #123");
    expect(descriptionOf(txn({ memo: " " }))).toBe("KROGER #123");
    expect(descriptionOf(txn({ description: "", memo: "Only memo" }))).toBe(
      "Only memo",
    );
  });
});

describe("toParsedRows", () => {
  it("maps rows and cleans the merchant", () => {
    const { rows, skipped } = toParsedRows([
      txn({ id: "a", description: "KROGER #123 CINCINNATI OH" }),
      txn({
        id: "b",
        posted: 0,
        transacted_at: 1788652800,
        amount: "45.00",
        description: "Refund",
      }),
    ]);
    expect(skipped).toEqual([]);
    expect(rows).toEqual([
      {
        row: {
          date: "2026-09-05",
          amountCents: -1234,
          rawDescription: "KROGER #123 CINCINNATI OH",
          merchant: "Kroger",
        },
        externalId: "a",
        pending: false,
      },
      {
        row: {
          date: "2026-09-06",
          amountCents: 4500,
          rawDescription: "Refund",
          merchant: "Refund",
        },
        externalId: "b",
        pending: true,
      },
    ]);
  });

  it("skips and reports rows it cannot parse", () => {
    const { rows, skipped } = toParsedRows([
      txn({ id: "bad-amount", amount: "1,000.00" }),
      txn({ id: "no-date", posted: 0 }),
      txn({ id: "ok" }),
    ]);
    expect(rows.map((r) => r.externalId)).toEqual(["ok"]);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]).toContain("bad-amount");
    expect(skipped[1]).toContain("no-date");
  });

  it("never produces an empty description", () => {
    const { rows } = toParsedRows([txn({ description: "" })]);
    expect(rows[0].row.rawDescription).toBe("(no description)");
  });
});
