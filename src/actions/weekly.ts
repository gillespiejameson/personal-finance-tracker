"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { detectAnomalies } from "@/lib/anomalies/detect";
import { listDismissed } from "@/lib/anomalies/store";
import { todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";
import { listGoals } from "@/lib/goals/store";
import {
  completeMonths,
  dataMonths,
  monthTotals,
} from "@/lib/insights/aggregate";
import type { Line } from "@/lib/insights/lines";
import { cachedBills, cachedBudgetPage, cachedLines } from "@/lib/loaders";
import { queueCount } from "@/lib/review/queue";
import { buildWeeklyPage } from "@/lib/ritual/page";
import {
  accountImportRows,
  completeWeek,
  listWeekStarts,
} from "@/lib/ritual/store";
import type { ReviewStatus, WeeklyPage } from "@/lib/ritual/types";
import { reviewStatus } from "@/lib/ritual/weeks";

function refresh() {
  for (const p of ["/weekly", "/home"]) revalidatePath(p);
}

function averageSpend(lines: Line[], month: string): number | null {
  const totals = monthTotals(lines);
  const window = completeMonths(dataMonths(lines), month).slice(-3);
  if (window.length === 0) return null;
  const sum = window.reduce((s, m) => s + (totals.get(m)?.spent ?? 0), 0);
  return sum / window.length;
}

export async function getWeeklyPage(): Promise<WeeklyPage> {
  const db = getDb();
  const today = todayIso();
  const month = today.slice(0, 7);
  const status = reviewStatus(listWeekStarts(db), today);
  const accounts = accountImportRows(db, today);
  const count = queueCount(db);
  const budget = cachedBudgetPage(today, month);
  const lines = cachedLines();
  const insightsSpent = monthTotals(lines).get(month)?.spent ?? 0;
  const avgSpend = averageSpend(lines, month);
  const bills = cachedBills(today).bills;
  const goals = listGoals(db, lines, today);
  const possibleDuplicateIds = new Set(
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.possibleDuplicate, true))
      .all()
      .map((r) => r.id),
  );
  const anomalies = detectAnomalies({
    lines,
    bills,
    today,
    possibleDuplicateIds,
  });
  const dismissed = new Set(listDismissed(db));
  const alertCount = anomalies.filter((a) => !dismissed.has(a.key)).length;
  return buildWeeklyPage({
    today,
    status,
    accounts,
    queueCount: count,
    budget,
    insightsSpent,
    avgSpend,
    bills,
    goals,
    alertCount,
  });
}

export async function completeWeeklyReview(): Promise<{
  ok: true;
  weekStart: string;
  streak: number;
}> {
  const db = getDb();
  const today = todayIso();
  const { weekStart } = completeWeek(db, today);
  const streak = reviewStatus(listWeekStarts(db), today).streak;
  refresh();
  return { ok: true, weekStart, streak };
}

export async function getReviewStatusAction(): Promise<ReviewStatus> {
  const db = getDb();
  return reviewStatus(listWeekStarts(db), todayIso());
}
