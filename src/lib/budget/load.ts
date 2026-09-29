import type { Db } from "@/lib/db/client";
import { dataMonths } from "@/lib/insights/aggregate";
import { loadLines } from "@/lib/insights/lines";
import type { Pre } from "@/lib/pre";
import { listBills } from "@/lib/recurring/refresh";
import { irregularItems, spreadByLeaf } from "@/lib/spreading/items";
import { listPlanned } from "@/lib/spreading/store";
import { budgetGate } from "./gate";
import { buildBudgetPage } from "./page";
import { resolvePayday } from "./payday";
import { getBudgetIncome, listBudgetLeaves, listBudgetRows } from "./store";
import type { BudgetPage } from "./types";

/** The Budget page for one month — shared by the page action and the wall summary. */
export function loadBudgetPage(
  db: Db,
  today: string,
  month: string,
  pre: Pre = {},
): BudgetPage {
  const lines = pre.lines ?? loadLines(db);
  const leaves = listBudgetLeaves(db);
  const rows = listBudgetRows(db);
  const incomeCents = getBudgetIncome(db, month);
  const bills = pre.bills ?? listBills(db, { today }).bills;
  const payday = resolvePayday(db, bills, today);
  const gate = budgetGate(db, today);
  const planned = listPlanned(db);
  const items = irregularItems({ bills, planned, today, leaves });
  return buildBudgetPage({
    lines,
    leaves,
    rows,
    incomeCents,
    bills,
    spread: spreadByLeaf(items),
    setAside: items,
    month,
    today,
    payday,
    gate,
    dataMonths: dataMonths(lines),
  });
}
