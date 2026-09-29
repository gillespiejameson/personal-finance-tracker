"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type Bill,
  dismissBill,
  refreshBills,
  removeManualBillAction,
  renameBillMerchant,
  setBillCategory,
  undismissBill,
} from "@/actions/bills";
import type { CategoryOption } from "@/actions/review";
import { AmountText } from "@/components/finance/AmountText";
import { CategoryChip } from "@/components/finance/CategoryChip";
import { Sparkline } from "@/components/finance/charts/Sparkline";
import { CADENCE_LABELS as CADENCE } from "@/components/finance/MarkAsBillForm";
import { Button } from "@/components/ui/button";
import { PARENT_COLORS } from "@/lib/categories/palette";

const due = (d: number) =>
  d < 0
    ? `overdue by ${-d} day${-d === 1 ? "" : "s"}`
    : d === 0
      ? "due today"
      : `due in ${d} day${d === 1 ? "" : "s"}`;

const monthlyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

type RunFn = <R extends { ok: boolean; error?: string }>(
  fn: () => Promise<R>,
  done?: (r: Extract<R, { ok: true }>) => string,
) => void;

type BillRowVariant = "active" | "ended" | "dismissed";

function BillRow({
  b,
  categories,
  pending,
  picking,
  setPicking,
  run,
  variant = "active",
}: {
  b: Bill;
  categories: CategoryOption[];
  pending: boolean;
  picking: number | null;
  setPicking: (id: number | null) => void;
  run: RunFn;
  variant?: BillRowVariant;
}) {
  const showDueStatus = variant === "active";
  const reduced = variant !== "active";
  return (
    <div
      className={`grid grid-cols-[1fr_150px_120px_130px_90px_auto] items-center gap-4 border-b border-line px-5 py-3 ${reduced ? "opacity-50" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 truncate text-body font-medium">
          {b.merchant}
          {variant === "ended" ? (
            <span className="rounded-pill bg-subtle px-2 text-micro font-semibold text-ink-2">
              Ended
            </span>
          ) : (
            <>
              {b.isNew && (
                <span className="rounded-pill bg-warning px-2 text-micro font-semibold text-white">
                  New
                </span>
              )}
              {!b.active && (
                <span className="text-micro text-ink-3">inactive</span>
              )}
            </>
          )}
          {b.manual ? (
            <span
              className="rounded-pill bg-subtle px-2 text-micro font-semibold text-ink-2"
              title="Added by hand from a transaction"
            >
              Manual
            </span>
          ) : (
            b.confidence === "likely" && (
              <span
                className="rounded-pill border border-dashed border-warning px-2 text-micro font-semibold text-warning"
                title="Two identical charges a month apart; a third confirms it"
              >
                Likely
              </span>
            )
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-caption text-ink-2">
          {picking === b.id ? (
            <select
              className="h-7 rounded-control border border-line bg-card px-2 text-caption"
              defaultValue={b.categoryId ?? ""}
              onBlur={() => setPicking(null)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setPicking(null);
                if (v)
                  run(
                    () => setBillCategory({ billId: b.id, categoryId: v }),
                    (r) => `Rule saved · ${r.applied} transactions updated`,
                  );
              }}
            >
              <option value="">Pick a category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentName ? `${c.parentName} › ` : ""}
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => setPicking(b.id)}
              className="rounded-pill"
            >
              <CategoryChip
                name={b.categoryName ?? "Uncategorized"}
                color={b.color ?? PARENT_COLORS.uncategorized}
                dashed={!b.categoryName}
              />
            </button>
          )}
          <span className="rounded-pill bg-subtle px-2 py-0.5 text-micro">
            {CADENCE[b.cadence]}
          </span>
        </div>
      </div>
      <div className="text-right">
        <AmountText
          cents={b.avgCents}
          colorize={b.isIncome}
          size="body"
          className="font-medium"
        />
        <div className="tnum text-micro text-ink-3">
          ≈ {monthlyFmt.format(Math.abs(b.monthlyCents) / 100)}/mo
        </div>
      </div>
      <div className="tnum text-caption text-ink-2">last {b.lastSeen}</div>
      <div className="text-caption">
        {showDueStatus && (
          <>
            <div className="tnum">{b.nextExpected}</div>
            <div className={b.dueInDays < 0 ? "text-negative" : "text-ink-2"}>
              {due(b.dueInDays)}
            </div>
          </>
        )}
      </div>
      <Sparkline
        values={b.recentAmounts}
        color={b.color ?? PARENT_COLORS.uncategorized}
      />
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            const name = window.prompt("Show this merchant as:", b.merchant);
            if (name && name !== b.merchant)
              run(
                () => renameBillMerchant({ merchant: b.merchant, name }),
                (r) => `Renamed on ${r.updated} transactions`,
              );
          }}
        >
          Rename
        </Button>
        {b.manual ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  `Remove the ${b.merchant} bill? It was added by hand and Refresh will not bring it back.`,
                )
              )
                run(
                  () => removeManualBillAction(b.id),
                  () => "Bill removed",
                );
            }}
          >
            Remove
          </Button>
        ) : b.dismissed ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => undismissBill(b.id))}
          >
            Restore
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => dismissBill(b.id))}
          >
            Not a bill
          </Button>
        )}
      </div>
    </div>
  );
}

export function BillsList({
  bills,
  categories,
  showDismissed,
}: {
  bills: Bill[];
  categories: CategoryOption[];
  showDismissed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState<number | null>(null);
  const run: RunFn = (fn, done) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? "Something went wrong");
        return;
      }
      if (done) toast.success(done(r as Extract<typeof r, { ok: true }>));
      router.refresh();
    });
  const liveBills = bills.filter(
    (b) => b.active && !b.dismissed && !b.isIncome,
  );
  const income = bills.filter((b) => b.active && !b.dismissed && b.isIncome);
  const ended = bills.filter((b) => !b.active && !b.dismissed);
  const dismissed = bills.filter((b) => b.dismissed);
  const rowProps = { categories, pending, picking, setPicking, run };
  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <Link
          href={showDismissed ? "/bills" : "/bills?dismissed=1"}
          className="text-caption text-accent"
        >
          {showDismissed ? "Hide dismissed" : "Show dismissed"}
        </Link>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => refreshBills(),
              (r) =>
                `${r.detected} recurring charge${r.detected === 1 ? "" : "s"} found · ${r.likely} likely`,
            )
          }
        >
          Refresh
        </Button>
      </div>
      <div>
        <h2 className="mb-2 text-headline font-semibold">Bills</h2>
        <div className="overflow-hidden rounded-card bg-card shadow-card">
          {liveBills.map((b) => (
            <BillRow key={b.id} b={b} variant="active" {...rowProps} />
          ))}
          {liveBills.length === 0 && (
            <div className="p-8 text-center text-ink-2">
              No recurring charges detected yet. Import a few months of
              statements.
            </div>
          )}
        </div>
      </div>
      {income.length > 0 && (
        <div>
          <h2 className="mb-2 text-headline font-semibold">Expected income</h2>
          <div className="overflow-hidden rounded-card bg-card shadow-card">
            {income.map((b) => (
              <BillRow key={b.id} b={b} variant="active" {...rowProps} />
            ))}
          </div>
        </div>
      )}
      {ended.length > 0 && (
        <div>
          <h2 className="mb-2 text-headline font-semibold">Ended</h2>
          <div className="overflow-hidden rounded-card bg-card shadow-card">
            {ended.map((b) => (
              <BillRow key={b.id} b={b} variant="ended" {...rowProps} />
            ))}
          </div>
        </div>
      )}
      {showDismissed && dismissed.length > 0 && (
        <div>
          <h2 className="mb-2 text-headline font-semibold">Dismissed</h2>
          <div className="overflow-hidden rounded-card bg-card shadow-card">
            {dismissed.map((b) => (
              <BillRow key={b.id} b={b} variant="dismissed" {...rowProps} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
