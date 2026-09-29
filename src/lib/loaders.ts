import { cache } from "react";
import { loadAlerts } from "@/lib/anomalies/load";
import { loadBudgetPage } from "@/lib/budget/load";
import { getDb } from "@/lib/db/client";
import { loadLines } from "@/lib/insights/lines";
import { listBills } from "@/lib/recurring/refresh";

/**
 * Per-request memos of the loads several actions share. One render of a page
 * can call three or four actions that each read the whole ledger and rebuild
 * the bill list; React's `cache` collapses those to one read per request, and
 * the cache is discarded when the request ends, so a later request sees fresh
 * data. Library code keeps taking an explicit `db` so tests stay in-memory —
 * this module is the only place `getDb()` is baked in, which is why it is not
 * a `"use server"` file (those may export only async functions).
 */
export const cachedLines = cache(() => loadLines(getDb()));

export const cachedBills = cache((today: string) =>
  listBills(getDb(), { today }),
);

export const cachedBudgetPage = cache((today: string, month: string) =>
  loadBudgetPage(getDb(), today, month, {
    lines: cachedLines(),
    bills: cachedBills(today).bills,
  }),
);

export const cachedAlerts = cache((today: string, includeDismissed: boolean) =>
  loadAlerts(
    getDb(),
    today,
    { includeDismissed },
    { lines: cachedLines(), bills: cachedBills(today).bills },
  ),
);
