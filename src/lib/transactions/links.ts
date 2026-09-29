import { monthEnd } from "@/lib/dates";

/** `from`/`to` covering one `YYYY-MM` month, as the Transactions page reads them. */
export function monthRangeQuery(month: string): string {
  return `from=${month}-01&to=${monthEnd(month)}`;
}

/** Transactions filtered to one leaf category for a month. */
export function leafTransactionsHref(categoryId: number, month: string) {
  return `/transactions?category=${categoryId}&${monthRangeQuery(month)}`;
}

/** Transactions filtered to every leaf under a group for a month. */
export function groupTransactionsHref(parentId: number, month: string) {
  return `/transactions?group=${parentId}&${monthRangeQuery(month)}`;
}
