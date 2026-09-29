import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";
import { loadLines } from "@/lib/insights/lines";
import type { Pre } from "@/lib/pre";
import { listBills } from "@/lib/recurring/refresh";
import { detectAnomalies } from "./detect";
import { listDismissed } from "./store";
import type { AlertsPage } from "./types";

/** The Alerts page — shared by the page action and the wall summary. */
export function loadAlerts(
  db: Db,
  today: string,
  opts: { includeDismissed?: boolean } = {},
  pre: Pre = {},
): AlertsPage & { dismissedKeys: string[] } {
  // Full history: merchant baselines need it.
  const lines = pre.lines ?? loadLines(db);
  const bills = pre.bills ?? listBills(db, { today }).bills;
  const possibleDuplicateIds = new Set(
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.possibleDuplicate, true))
      .all()
      .map((r) => r.id),
  );
  const all = detectAnomalies({ lines, bills, today, possibleDuplicateIds });
  const dismissedKeys = listDismissed(db);
  const dismissedSet = new Set(dismissedKeys);
  const dismissedCount = all.filter((a) => dismissedSet.has(a.key)).length;
  const anomalies = opts.includeDismissed
    ? all
    : all.filter((a) => !dismissedSet.has(a.key));
  return { today, anomalies, dismissedCount, dismissedKeys };
}
