import { monthEnd } from "@/lib/dates";
import type { Pace } from "./types";

export const PACE_TOLERANCE = 0.05;

export function pace(i: {
  spentCents: number;
  referenceCents: number;
  today: string;
  reference: Pace["reference"];
}): Pace {
  const day = Number(i.today.slice(8, 10));
  const days = Number(monthEnd(i.today.slice(0, 7)).slice(8, 10));
  const elapsed = day / days;
  const used =
    i.reference !== "none" && i.referenceCents > 0
      ? i.spentCents / i.referenceCents
      : 0;
  const status =
    i.reference === "none"
      ? "on"
      : used > elapsed + PACE_TOLERANCE
        ? "ahead"
        : used < elapsed - PACE_TOLERANCE
          ? "behind"
          : "on";
  return {
    elapsed,
    used,
    status,
    spentCents: i.spentCents,
    referenceCents: i.referenceCents,
    reference: i.reference,
  };
}
