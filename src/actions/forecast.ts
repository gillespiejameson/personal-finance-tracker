"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listBudgetLeaves } from "@/lib/budget/store";
import { todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { forecastEvents } from "@/lib/forecast/events";
import { spendRate } from "@/lib/forecast/rate";
import {
  CASH_TYPES,
  forecastSeries,
  startingCash,
  summarize,
} from "@/lib/forecast/series";
import { getFloor, setFloor } from "@/lib/forecast/store";
import type { ForecastPage } from "@/lib/forecast/types";
import {
  completeMonths,
  dataMonths,
  monthTotals,
} from "@/lib/insights/aggregate";
import { cachedBills, cachedBudgetPage, cachedLines } from "@/lib/loaders";
import { latestBalances } from "@/lib/networth/series";
import { listSnapshots } from "@/lib/networth/store";
import { irregularItems } from "@/lib/spreading/items";
import { listPlanned } from "@/lib/spreading/store";

type Fail = { ok: false; error: string };
type Horizon = 30 | 60 | 90;
const VALID_DAYS = new Set<Horizon>([30, 60, 90]);

function refresh() {
  for (const p of ["/forecast", "/home"]) revalidatePath(p);
}

function resolveDays(days?: string | number): Horizon {
  const n = typeof days === "string" ? Number(days) : days;
  return n !== undefined && VALID_DAYS.has(n as Horizon) ? (n as Horizon) : 30;
}

export async function getForecast(
  days?: string | number,
): Promise<ForecastPage> {
  const db = getDb();
  const today = todayIso();
  const resolvedDays = resolveDays(days);
  const floorCents = getFloor(db);

  const accountRows = db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .all();
  const snapshots = listSnapshots(db);
  const latest = latestBalances(snapshots, today);
  const balances = accountRows.map((a) => ({
    type: a.type,
    balanceCents: latest.get(a.id)?.balanceCents ?? null,
  }));
  const startCents = startingCash(balances);
  const hasCash = balances.some(
    (b) => CASH_TYPES.has(b.type) && b.balanceCents !== null,
  );

  const { bills } = cachedBills(today);
  const leaves = listBudgetLeaves(db);
  const planned = listPlanned(db);
  const items = irregularItems({ bills, planned, today, leaves });
  // Quarterly/annual bills are already forecast below via the bills loop
  // (which steps every cadence); only planned-expense-sourced items are new
  // here, so bill-sourced irregular items are excluded to avoid double-
  // counting the same cash movement twice.
  const plannedEvents = items.filter((i) => i.source === "planned");
  const events = forecastEvents({
    bills,
    planned: plannedEvents,
    today,
    days: resolvedDays,
  });

  const currentMonth = today.slice(0, 7);
  const budget = cachedBudgetPage(today, currentMonth);
  const lines = cachedLines();
  const totals = monthTotals(lines);
  const avgWindow = completeMonths(dataMonths(lines), currentMonth).slice(-3);
  const avgVariableCents =
    avgWindow.length > 0
      ? Math.round(
          avgWindow.reduce((s, m) => s + (totals.get(m)?.variable ?? 0), 0) /
            avgWindow.length,
        )
      : null;
  // The budget's variable leaves never include uncategorized transactions
  // (they have no category to sit under), so this average — over the same
  // trailing window — lets the budget-path rate account for that spend too.
  const uncategorizedByMonth = new Map<string, number>();
  for (const l of lines) {
    if (l.categoryId === null && l.amountCents < 0) {
      uncategorizedByMonth.set(
        l.month,
        (uncategorizedByMonth.get(l.month) ?? 0) - l.amountCents,
      );
    }
  }
  const avgUncategorizedCents =
    avgWindow.length > 0
      ? Math.round(
          avgWindow.reduce(
            (s, m) => s + (uncategorizedByMonth.get(m) ?? 0),
            0,
          ) / avgWindow.length,
        )
      : null;
  const rate = spendRate({
    budget,
    avgVariableCents,
    avgUncategorizedCents,
    today,
  });

  const points = forecastSeries({
    startCents,
    today,
    days: resolvedDays,
    events,
    rate,
  });
  const summary = summarize(points, floorCents);

  const balanceByDate = new Map(points.map((p) => [p.date, p.balanceCents]));
  const eventsWithAfter = events.map((e) => ({
    ...e,
    afterCents: balanceByDate.get(e.date) ?? 0,
  }));

  return {
    today,
    days: resolvedDays,
    floorCents,
    hasCash,
    startCents,
    rate,
    points,
    events: eventsWithAfter,
    ...summary,
  };
}

const setForecastFloorSchema = z.object({
  cents: z
    .number()
    .int()
    .min(0)
    .max(1_000_000_000, "That amount is too large."),
});

export async function setForecastFloor(input: {
  cents: number;
}): Promise<{ ok: true } | Fail> {
  const p = setForecastFloorSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Invalid amount.",
    };
  setFloor(getDb(), p.data.cents);
  refresh();
  return { ok: true };
}
