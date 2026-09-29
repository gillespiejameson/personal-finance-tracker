"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setDebtExtraAction, setDebtTermsAction } from "@/actions/debt";
import { AmountText } from "@/components/finance/AmountText";
import { DebtChart } from "@/components/finance/debt/DebtChart";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { comparisonSentence } from "@/lib/debt/compare";
import type { DebtPage, DebtResult, DebtRow, Strategy } from "@/lib/debt/types";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

function monthLabel(month: string): string {
  return new Date(`${month}-15T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function StrategyControl({ strategy }: { strategy: Strategy }) {
  const router = useRouter();
  const options: { value: Strategy; label: string }[] = [
    { value: "avalanche", label: "Avalanche" },
    { value: "snowball", label: "Snowball" },
  ];
  return (
    <div className="inline-flex gap-1 rounded-control bg-subtle p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={strategy === o.value}
          onClick={() => router.replace(`/debt?strategy=${o.value}`)}
          className={cn(
            "rounded-control px-3 py-1.5 text-caption! font-medium transition-colors",
            strategy === o.value
              ? "bg-card text-ink shadow-card"
              : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ExtraInput({ extraCents }: { extraCents: number }) {
  const router = useRouter();
  const [value, setValue] = useState(
    formatCents(extraCents, { sign: "never" }),
  );
  const [pending, start] = useTransition();

  function save() {
    const cents = parseAmountToCents(value);
    if (cents === null || cents < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    start(async () => {
      const r = await setDebtExtraAction({ cents });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Extra payment saved");
      router.refresh();
    });
  }

  return (
    <div className="flex items-end gap-2">
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor="debt-extra-input"
      >
        Extra per month
        <Input
          id="debt-extra-input"
          inputMode="decimal"
          placeholder="$0.00"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-28"
        />
      </label>
      <Button disabled={pending} onClick={save}>
        Save
      </Button>
    </div>
  );
}

function DebtTermsRow({ row, result }: { row: DebtRow; result?: DebtResult }) {
  const router = useRouter();
  const [aprInput, setAprInput] = useState(
    row.aprBps === null ? "" : (row.aprBps / 100).toFixed(2),
  );
  const [minInput, setMinInput] = useState(
    row.minPaymentCents === null
      ? ""
      : formatCents(row.minPaymentCents, { sign: "never" }),
  );
  const [pending, start] = useTransition();

  function save() {
    const aprPercent = Number(aprInput);
    if (
      aprInput.trim() === "" ||
      Number.isNaN(aprPercent) ||
      aprPercent < 0 ||
      aprPercent > 100
    ) {
      toast.error("Enter an APR between 0 and 100");
      return;
    }
    const minPaymentCents = parseAmountToCents(minInput);
    if (minPaymentCents === null || minPaymentCents < 0) {
      toast.error("Enter a valid minimum payment");
      return;
    }
    start(async () => {
      const r = await setDebtTermsAction({
        accountId: row.id,
        aprPercent,
        minPaymentCents,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Terms saved");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 last:border-b-0">
      <span
        className="size-3 shrink-0 rounded-pill"
        style={{ backgroundColor: row.color }}
      />
      <div className="min-w-[140px] flex-1">
        <div className="flex items-center gap-2">
          <span className="text-body font-medium">{row.name}</span>
          {row.missing === "balance" && (
            <span className="rounded-pill bg-subtle px-1.5 text-micro text-ink-3">
              Needs a{" "}
              <Link href="/networth" className="text-accent">
                balance
              </Link>
            </span>
          )}
          {row.missing === "terms" && (
            <span className="rounded-pill bg-subtle px-1.5 text-micro text-ink-3">
              Needs details
            </span>
          )}
        </div>
        <div className="mt-0.5 text-caption text-ink-2">
          {row.balanceCents === null ? (
            "No balance yet"
          ) : (
            <span className="tnum text-negative">
              −{formatCents(row.balanceCents, { sign: "never" })}
            </span>
          )}
        </div>
      </div>

      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`debt-apr-${row.id}`}
      >
        APR %
        <Input
          id={`debt-apr-${row.id}`}
          type="number"
          step="0.01"
          min={0}
          max={100}
          value={aprInput}
          onChange={(e) => setAprInput(e.target.value)}
          className="w-24"
        />
      </label>
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`debt-min-${row.id}`}
      >
        Minimum
        <Input
          id={`debt-min-${row.id}`}
          inputMode="decimal"
          placeholder="$0.00"
          value={minInput}
          onChange={(e) => setMinInput(e.target.value)}
          className="w-24"
        />
      </label>
      <Button disabled={pending} onClick={save}>
        Save
      </Button>

      <div className="min-w-[160px] text-right text-caption">
        {result?.stalled ? (
          <span className="text-negative">
            Minimum doesn&apos;t cover interest
          </span>
        ) : result?.payoffMonth ? (
          <>
            <div className="text-ink">
              Paid off {monthLabel(result.payoffMonth)}
            </div>
            <div className="tnum text-ink-2">
              {formatCents(result.interestCents, { sign: "never" })} interest
            </div>
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </div>
    </div>
  );
}

export function DebtPlanner({ page }: { page: DebtPage }) {
  const { plan, comparison } = page;

  const orderedIds = plan?.order ?? [];
  const orderedRows = [
    ...orderedIds
      .map((id) => page.debts.find((d) => d.id === id))
      .filter((d): d is DebtRow => !!d),
    ...page.debts.filter((d) => !orderedIds.includes(d.id)),
  ];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <StrategyControl strategy={page.strategy} />
        <ExtraInput extraCents={page.extraCents} />
      </div>

      {plan ? (
        <>
          <Card className="mb-6">
            <div className="text-caption text-ink-2">
              {plan.totals.finished
                ? `Debt-free by ${monthLabel(plan.totals.payoffMonth as string)}`
                : "Not on track"}
            </div>
            <div className="tnum mt-1 text-caption text-ink-2">
              <AmountText
                cents={page.debts
                  .filter((d) => d.ready)
                  .reduce((s, d) => s + (d.balanceCents ?? 0), 0)}
                colorize={false}
                className="text-ink"
              />{" "}
              remaining
              {plan.totals.finished && (
                <>
                  {" "}
                  · {formatCents(plan.totals.interestCents, { sign: "never" })}{" "}
                  interest with {plan.strategy}
                </>
              )}
            </div>
            {!plan.totals.finished && (
              <div className="mt-1 text-caption text-ink-2">
                {plan.debts.some((d) => d.stalled)
                  ? "A minimum payment doesn't cover its interest — raise it or add an extra payment."
                  : "These minimums take more than 50 years — add an extra payment to see a date."}
              </div>
            )}
            {comparison && (
              <div className="mt-1 text-caption text-ink-2">
                {comparisonSentence(comparison)}
              </div>
            )}
          </Card>

          <Card className="mb-6">
            <DebtChart series={plan.series} />
          </Card>
        </>
      ) : (
        <p className="mb-6 text-caption text-ink-2">
          Set APR and a minimum payment on at least one debt below to see a
          payoff plan.
        </p>
      )}

      <Card className="p-0">
        {orderedRows.map((row) => (
          <DebtTermsRow
            key={row.id}
            row={row}
            result={plan?.debts.find((d) => d.id === row.id)}
          />
        ))}
      </Card>
    </>
  );
}
