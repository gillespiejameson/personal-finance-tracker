import { loadAlerts } from "@/lib/anomalies/load";
import { loadBudgetPage } from "@/lib/budget/load";
import { listBudgetLeaves } from "@/lib/budget/store";
import { todayIso } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import { loadLines } from "@/lib/insights/lines";
import { listBills } from "@/lib/recurring/refresh";
import { queueCount } from "@/lib/review/queue";
import { listWeekStarts } from "@/lib/ritual/store";
import { reviewStatus } from "@/lib/ritual/weeks";
import { irregularItems } from "@/lib/spreading/items";
import { listPlanned } from "@/lib/spreading/store";
import { buildWallSummary } from "./summary";
import type { WallSummary } from "./types";

/** Everything the wall shows, from the same loaders the app's own pages use. */
export function loadWallSummary(db: Db, now: Date): WallSummary {
  const today = todayIso();
  // Loaded once here and handed to both loaders below, which would otherwise
  // read the whole ledger and the bill list again apiece.
  const pre = { lines: loadLines(db), bills: listBills(db, { today }).bills };
  const bills = pre.bills;
  const budget = loadBudgetPage(db, today, today.slice(0, 7), pre);
  const items = irregularItems({
    bills,
    planned: listPlanned(db),
    today,
    leaves: listBudgetLeaves(db),
  });
  return buildWallSummary({
    today,
    now,
    budget,
    bills,
    reviewCount: queueCount(db),
    review: reviewStatus(listWeekStarts(db), today),
    items,
    alertCount: loadAlerts(db, today, {}, pre).anomalies.length,
  });
}
