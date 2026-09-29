import type { RestOfMonth, SafeToSpend } from "./types";

function pace(remaining: number, bills: number, daysUntil: number) {
  const totalCents = Math.max(0, remaining - bills);
  const days = Math.max(1, daysUntil);
  return { totalCents, perDayCents: Math.floor(totalCents / days), days };
}

export function safeToSpend(i: {
  variableRemainingCents: number;
  unpostedBillsCents: number;
  daysUntil: number;
  horizon: string;
  horizonKind: "payday" | "monthEnd";
  restOfMonth?: {
    unpostedBillsCents: number;
    daysUntil: number;
    horizon: string;
  };
}): SafeToSpend {
  const main = pace(
    i.variableRemainingCents,
    i.unpostedBillsCents,
    i.daysUntil,
  );
  let restOfMonth: RestOfMonth | null = null;
  if (i.restOfMonth) {
    const r = pace(
      i.variableRemainingCents,
      i.restOfMonth.unpostedBillsCents,
      i.restOfMonth.daysUntil,
    );
    restOfMonth = {
      totalCents: r.totalCents,
      perDayCents: r.perDayCents,
      unpostedBillsCents: i.restOfMonth.unpostedBillsCents,
      horizon: i.restOfMonth.horizon,
      daysUntil: r.days,
    };
  }
  return {
    totalCents: main.totalCents,
    perDayCents: main.perDayCents,
    variableRemainingCents: i.variableRemainingCents,
    unpostedBillsCents: i.unpostedBillsCents,
    horizon: i.horizon,
    daysUntil: main.days,
    horizonKind: i.horizonKind,
    restOfMonth,
  };
}
