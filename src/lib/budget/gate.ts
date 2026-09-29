import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";
import type { Gate } from "./types";

export const GATE_NEEDED = 2;
export const DATA_MONTH_MIN_ROWS = 20;

/** Complete data months = months before the current one with ≥ 20 non-transfer transactions. */
export function budgetGate(db: Db, today: string): Gate {
  const current = today.slice(0, 7);
  const rows = db
    .select({
      month: sql<string>`substr(${transactions.date}, 1, 7)`,
      n: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(sql`${transactions.isTransfer} = 0`)
    .groupBy(sql`substr(${transactions.date}, 1, 7)`)
    .all();
  const complete = rows.filter(
    (r) => r.month < current && r.n >= DATA_MONTH_MIN_ROWS,
  ).length;
  return {
    open: complete >= GATE_NEEDED,
    completeMonths: complete,
    needed: GATE_NEEDED,
  };
}
