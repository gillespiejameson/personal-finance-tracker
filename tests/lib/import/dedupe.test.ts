import { describe, expect, it } from "vitest";
import {
  dedupeHash,
  findFuzzyDuplicates,
  normalizeForHash,
  similarity,
} from "@/lib/import/dedupe";

describe("dedupeHash", () => {
  const row = {
    date: "2026-03-14",
    amountCents: -8810,
    rawDescription: "KROGER #1234 CINCINNATI OH",
  };
  it("is stable and ignores whitespace/case/punctuation", () => {
    expect(dedupeHash(1, row)).toBe(
      dedupeHash(1, {
        ...row,
        rawDescription: "  kroger #1234, cincinnati oh ",
      }),
    );
    expect(dedupeHash(1, row)).toHaveLength(64);
  });
  it("differs by account, date, amount", () => {
    expect(dedupeHash(2, row)).not.toBe(dedupeHash(1, row));
    expect(dedupeHash(1, { ...row, date: "2026-03-15" })).not.toBe(
      dedupeHash(1, row),
    );
    expect(dedupeHash(1, { ...row, amountCents: -8811 })).not.toBe(
      dedupeHash(1, row),
    );
  });
  it("occurrence 0 keeps the legacy hash; later occurrences differ", () => {
    expect(dedupeHash(1, row, 0)).toBe(dedupeHash(1, row));
    expect(dedupeHash(1, row, 1)).not.toBe(dedupeHash(1, row));
    expect(dedupeHash(1, row, 1)).not.toBe(dedupeHash(1, row, 2));
  });
  it("normalizeForHash", () =>
    expect(normalizeForHash(" a-b  c! ")).toBe("ABC"));
});

describe("similarity", () => {
  it("identical → 1, unrelated → low", () => {
    expect(similarity("KROGER", "KROGER")).toBe(1);
    expect(similarity("KROGER", "NETFLIX")).toBeLessThan(0.6);
  });
  it("pending vs posted wording is similar", () => {
    expect(
      similarity("KROGER 1234 CINCINNATI", "KROGER 1234 CINCINNATI OH"),
    ).toBeGreaterThan(0.85);
  });
});

describe("findFuzzyDuplicates", () => {
  const existing = [
    {
      id: 9,
      date: "2026-03-14",
      amountCents: -8810,
      rawDescription: "KROGER #1234 CINCINNATI OH",
    },
  ];
  it("flags same amount within 3 days and similar text", () => {
    const m = findFuzzyDuplicates(
      [
        {
          date: "2026-03-16",
          amountCents: -8810,
          rawDescription: "KROGER 1234 CINCINNATI",
          merchant: "Kroger",
        },
      ],
      existing,
    );
    expect(m.get(0)).toBe(9);
  });
  it("ignores different amount or far date", () => {
    expect(
      findFuzzyDuplicates(
        [
          {
            date: "2026-03-16",
            amountCents: -8800,
            rawDescription: "KROGER 1234",
            merchant: "Kroger",
          },
        ],
        existing,
      ).size,
    ).toBe(0);
    expect(
      findFuzzyDuplicates(
        [
          {
            date: "2026-03-20",
            amountCents: -8810,
            rawDescription: "KROGER 1234",
            merchant: "Kroger",
          },
        ],
        existing,
      ).size,
    ).toBe(0);
  });
});
