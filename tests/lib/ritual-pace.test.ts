import { describe, expect, it } from "vitest";
import { pace } from "@/lib/ritual/pace";

describe("pace", () => {
  it("compares budget used against month elapsed with a 5-point tolerance", () => {
    // Sept 6 of 30 days → elapsed 0.2
    expect(
      pace({
        spentCents: 35000,
        referenceCents: 100000,
        today: "2026-09-06",
        reference: "budget",
      }),
    ).toMatchObject({ elapsed: 0.2, used: 0.35, status: "ahead" });
    expect(
      pace({
        spentCents: 22000,
        referenceCents: 100000,
        today: "2026-09-06",
        reference: "budget",
      }),
    ).toMatchObject({ status: "on" });
    expect(
      pace({
        spentCents: 10000,
        referenceCents: 100000,
        today: "2026-09-06",
        reference: "average",
      }),
    ).toMatchObject({ status: "behind", reference: "average" });
  });
  it("is neutral without a reference", () => {
    expect(
      pace({
        spentCents: 500,
        referenceCents: 0,
        today: "2026-02-14",
        reference: "none",
      }),
    ).toMatchObject({ elapsed: 0.5, used: 0, status: "on" });
  });
});
