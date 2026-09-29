import { describe, expect, it } from "vitest";
import {
  GROUP_COLORS,
  nextGroupColor,
  PARENT_COLORS,
  PARENT_KEYS,
  tint,
} from "@/lib/categories/palette";

describe("palette", () => {
  it("tints hex to rgba", () =>
    expect(tint("#FF9500", 0.12)).toBe("rgba(255, 149, 0, 0.12)"));
  it("every parent has a color", () => {
    for (const k of PARENT_KEYS)
      expect(PARENT_COLORS[k]).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe("nextGroupColor", () => {
  it("returns the first unused color when none are used", () => {
    expect(nextGroupColor([])).toBe(GROUP_COLORS[0]);
  });
  it("skips colors already used, case-insensitively", () => {
    expect(
      nextGroupColor([GROUP_COLORS[0].toLowerCase(), GROUP_COLORS[1]]),
    ).toBe(GROUP_COLORS[2]);
  });
  it("falls back to the least-used color, ties to the first, once all are used", () => {
    const allOnce = [...GROUP_COLORS];
    const extra = [...allOnce, GROUP_COLORS[3], GROUP_COLORS[3]];
    expect(nextGroupColor(extra)).toBe(GROUP_COLORS[0]);
  });
});
