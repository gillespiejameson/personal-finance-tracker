import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  isIsoDate,
  localDay,
  localStamp,
  monthEnd,
  monthOf,
  parseDateWithFormat,
  todayIso,
} from "@/lib/dates";

describe("parseDateWithFormat", () => {
  it.each([
    ["03/04/2026", "MDY", "2026-03-04"],
    ["03/04/2026", "DMY", "2026-04-03"],
    ["2026-03-04", "YMD", "2026-03-04"],
    ["3/4/26", "MDY", "2026-03-04"],
    ["04.03.2026", "DMY", "2026-03-04"],
    ["20260304", "YMD", "2026-03-04"],
  ] as const)("%s as %s → %s", (raw, f, iso) =>
    expect(parseDateWithFormat(raw, f)).toBe(iso));
  it("rejects impossible dates", () => {
    expect(parseDateWithFormat("13/40/2026", "MDY")).toBeNull();
    expect(parseDateWithFormat("02/30/2026", "MDY")).toBeNull();
    expect(parseDateWithFormat("hello", "MDY")).toBeNull();
  });
});

describe("helpers", () => {
  it("isIsoDate", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });
  it("daysBetween", () =>
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30));
  it("addDays crosses months", () =>
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02"));
  it("monthOf", () => expect(monthOf("2026-09-05")).toBe("2026-09"));
  it.each([
    ["2026-02", "2026-02-28"],
    ["2028-02", "2028-02-29"],
    ["2026-09", "2026-09-30"],
    ["2026-12", "2026-12-31"],
  ])("monthEnd(%s) → %s", (month, end) => expect(monthEnd(month)).toBe(end));
  it("todayIso is the local calendar date", () => {
    const t = new Date();
    const expected = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    expect(todayIso()).toBe(expected);
  });
});

describe("local day helpers", () => {
  it("localDay formats the local calendar day", () => {
    // Constructed with local components, so the expectation holds in any zone.
    expect(localDay(new Date(2026, 8, 7, 23, 30))).toBe("2026-09-07");
    expect(localDay(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
  it("todayIso is localDay(now)", () => {
    expect(todayIso()).toBe(localDay(new Date()));
  });
  it("localStamp is the local day plus a 24-hour time", () => {
    expect(localStamp(new Date(2026, 8, 7, 5, 6, 7))).toBe(
      "2026-09-07T05:06:07",
    );
  });
});
