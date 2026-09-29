import { describe, expect, it } from "vitest";
import { carryFor } from "@/lib/budget/rollover";

const rows = new Map([
  ["2026-06", 10000],
  ["2026-07", 10000],
  ["2026-09", 10000],
]); // August has no row
const spent = new Map([
  ["2026-06", 7000],
  ["2026-07", 12000],
  ["2026-08", 3000],
  ["2026-09", 1000],
]);

describe("carryFor", () => {
  it("is zero without rollover", () => {
    expect(carryFor({ rows, spent, rollover: false, month: "2026-07" })).toBe(
      0,
    );
  });
  it("carries the previous month's remaining, positive or negative", () => {
    expect(carryFor({ rows, spent, rollover: true, month: "2026-06" })).toBe(0);
    expect(carryFor({ rows, spent, rollover: true, month: "2026-07" })).toBe(
      3000,
    ); // 10000 − 7000
    expect(carryFor({ rows, spent, rollover: true, month: "2026-08" })).toBe(
      1000,
    ); // 10000 + 3000 − 12000
  });
  it("resets after a month with no budget row", () => {
    expect(carryFor({ rows, spent, rollover: true, month: "2026-09" })).toBe(0);
  });
});
