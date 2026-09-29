import Link from "next/link";
import { listAccounts } from "@/actions/accounts";
import {
  findCategoryGroupOption,
  listCategoryGroupOptions,
  listCategoryOptions,
  listTransactions,
  summarizeTransactions,
} from "@/actions/transactions";
import { TransactionFilters } from "@/components/finance/TransactionFilters";
import { TransactionsTable } from "@/components/finance/TransactionsTable";
import { buttonVariants } from "@/components/ui/button";
import { isIsoDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { parseIdParam } from "@/lib/sqlLike";
import { LIST_LIMIT, type TxnFilter } from "@/lib/transactions/summary";

/** Only the keys the filter actually set, in the query-param names the export route reads. */
function exportQuery(filter: TxnFilter): string {
  const params = new URLSearchParams();
  if (filter.accountId !== undefined)
    params.set("account", String(filter.accountId));
  if (filter.categoryId !== undefined)
    params.set("category", String(filter.categoryId));
  if (filter.parentId !== undefined)
    params.set("group", String(filter.parentId));
  if (filter.from !== undefined) params.set("from", filter.from);
  if (filter.to !== undefined) params.set("to", filter.to);
  if (filter.q !== undefined) params.set("q", filter.q);
  return params.toString();
}

export const dynamic = "force-dynamic";

const isoOrUndefined = (v: string | undefined) =>
  v && isIsoDate(v) ? v : undefined;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const filter = {
    accountId: parseIdParam(sp.account),
    categoryId: parseIdParam(sp.category),
    parentId: parseIdParam(sp.group),
    from: isoOrUndefined(sp.from),
    to: isoOrUndefined(sp.to),
    q: sp.q,
  };
  const [rows, summary, accounts, categories, activeGroups, currentGroup] =
    await Promise.all([
      listTransactions(filter),
      summarizeTransactions(filter),
      listAccounts(),
      listCategoryOptions(),
      listCategoryGroupOptions(),
      filter.parentId === undefined
        ? undefined
        : findCategoryGroupOption(filter.parentId),
    ]);
  // Groups with at least one active leaf. The group currently filtered on is
  // kept even when it has none (or is archived), so the select still shows it
  // rather than falling back to "All categories".
  const groups = activeGroups.filter((g) =>
    categories.some((c) => c.parentId === g.id),
  );
  if (currentGroup && !groups.some((g) => g.id === currentGroup.id))
    groups.push(currentGroup);
  return (
    <>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-title font-semibold">Transactions</h1>
          <p className="tnum text-caption text-ink-2">
            {summary.count.toLocaleString("en-US")} transactions · money out{" "}
            {formatCents(summary.spentCents, { sign: "never" })} · money in{" "}
            {formatCents(summary.receivedCents, { sign: "never" })}
          </p>
          {summary.count > rows.length && (
            <p className="tnum text-micro text-ink-3">
              Showing the most recent {LIST_LIMIT.toLocaleString("en-US")} of{" "}
              {summary.count.toLocaleString("en-US")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/export/transactions?${exportQuery(filter)}`}
            download
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Export CSV
          </a>
          <Link href="/import" className={buttonVariants({ size: "sm" })}>
            Import
          </Link>
        </div>
      </div>
      <TransactionFilters
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId,
        }))}
        groups={groups}
      />
      <TransactionsTable rows={rows} categories={categories} />
    </>
  );
}
