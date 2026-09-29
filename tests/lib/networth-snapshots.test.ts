import { describe, expect, it } from "vitest";
import type { ParsedRow } from "@/lib/import/types";
import { snapshotsFromRows } from "@/lib/networth/snapshots";

const r = (
  date: string,
  amountCents: number,
  balanceCents: number | null,
): ParsedRow => ({
  date,
  amountCents,
  rawDescription: "x",
  merchant: "x",
  balanceCents,
});

describe("snapshotsFromRows", () => {
  it("takes the end-of-day balance from a newest-first file", () => {
    // Chase order: newest first. Sept 3 has two rows; the first listed is the later one.
    const rows = [
      r("2026-09-03", -1000, 90000),
      r("2026-09-03", -500, 91000),
      r("2026-09-01", 2000, 91500),
    ];
    expect(snapshotsFromRows(rows)).toEqual([
      { date: "2026-09-01", balanceCents: 91500 },
      { date: "2026-09-03", balanceCents: 90000 },
    ]);
  });
  it("takes the last row of the day from an oldest-first file", () => {
    const rows = [
      r("2026-09-01", 2000, 91500),
      r("2026-09-03", -500, 91000),
      r("2026-09-03", -1000, 90000),
    ];
    expect(snapshotsFromRows(rows)).toEqual([
      { date: "2026-09-01", balanceCents: 91500 },
      { date: "2026-09-03", balanceCents: 90000 },
    ]);
  });
  it("ignores rows without a balance and files with none", () => {
    expect(
      snapshotsFromRows([r("2026-09-01", 1, null), r("2026-09-02", 1, 500)]),
    ).toEqual([{ date: "2026-09-02", balanceCents: 500 }]);
    expect(snapshotsFromRows([r("2026-09-01", 1, null)])).toEqual([]);
  });
  it("uses running arithmetic when the order cannot be told from dates", () => {
    // Single date: 91000 − 1000 = 90000, so the −1000 row comes after the −500 row → end of day 90000.
    const rows = [r("2026-09-03", -1000, 90000), r("2026-09-03", -500, 91000)];
    expect(snapshotsFromRows(rows)).toEqual([
      { date: "2026-09-03", balanceCents: 90000 },
    ]);
  });
  it("resolves a three-row same-day chain regardless of listed order", () => {
    // Chain: −500 → 91000, then −1000 → 90000, then −1000 → 89000 (end of day).
    const a = r("2026-09-03", -500, 91000);
    const b = r("2026-09-03", -1000, 90000);
    const c = r("2026-09-03", -1000, 89000);
    expect(snapshotsFromRows([b, c, a])).toEqual([
      { date: "2026-09-03", balanceCents: 89000 },
    ]);
  });
});
