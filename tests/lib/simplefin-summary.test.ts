import { describe, expect, it } from "vitest";
import { changedAnything, summarize } from "@/lib/simplefin/summary";
import type { SyncResult } from "@/lib/simplefin/types";

const result = (r: Partial<SyncResult>): SyncResult => ({
  sfinId: "ACT-1",
  name: "Checking",
  added: 0,
  updated: 0,
  matched: 0,
  pending: 0,
  removed: 0,
  balanceRecorded: false,
  ...r,
});

describe("summarize", () => {
  it("totals every account into one line", () => {
    expect(
      summarize([
        result({ added: 10, updated: 2, pending: 1 }),
        result({ sfinId: "ACT-2", added: 2, updated: 1, pending: 1 }),
      ]),
    ).toBe("Added 12 · updated 3 · pending 2");
  });
  it("reads zero for an empty sync", () => {
    expect(summarize([])).toBe("Added 0 · updated 0 · pending 0");
  });
});

describe("changedAnything", () => {
  it("is false when a sync only matched existing rows", () => {
    expect(changedAnything([result({ matched: 5, pending: 2 })])).toBe(false);
  });
  it("is true when rows were added, updated or removed", () => {
    expect(changedAnything([result({ added: 1 })])).toBe(true);
    expect(changedAnything([result({ updated: 1 })])).toBe(true);
    expect(changedAnything([result({ removed: 1 })])).toBe(true);
  });
});
