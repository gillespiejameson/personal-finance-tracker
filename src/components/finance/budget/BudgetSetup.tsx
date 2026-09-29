"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveBudget } from "@/actions/budget";
import { AmountField } from "@/components/finance/budget/AmountField";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SetupPage, SetupRow } from "@/lib/budget/types";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

function rowCaption(row: SetupRow): string {
  if (row.goalId !== null) {
    return `goal · ${formatCents(row.suggestedCents, { sign: "never" })}/mo needed`;
  }
  const parts: string[] = [];
  if (row.avgCents > 0)
    parts.push(`avg ${formatCents(row.avgCents, { sign: "never" })}`);
  if (row.lastMonthCents > 0)
    parts.push(
      `last month ${formatCents(row.lastMonthCents, { sign: "never" })}`,
    );
  if (row.billsCents > 0)
    parts.push(`bills ${formatCents(row.billsCents, { sign: "never" })}`);
  if (row.plannedCents > 0)
    parts.push(
      `planned: ${formatCents(row.plannedCents, { sign: "never" })}/mo for ${row.plannedNames.join(", ")}`,
    );
  return parts.join(" · ");
}

function SetupRowLine({
  row,
  amount,
  onCommit,
}: {
  row: SetupRow;
  amount: number;
  onCommit: (cents: number) => void;
}) {
  const caption = rowCaption(row);
  return (
    <div className="grid grid-cols-[1fr_140px] items-center gap-3 border-t border-line py-2 first:border-t-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-body font-medium">
          <span className="truncate">{row.name}</span>
          <span className="rounded-pill bg-subtle px-1.5 text-micro text-ink-3">
            {row.goalId !== null ? "goal" : row.isFixed ? "fixed" : "variable"}
          </span>
        </div>
        {caption && <div className="text-caption text-ink-3">{caption}</div>}
      </div>
      <AmountField
        cents={amount}
        ariaLabel={`Amount for ${row.name}`}
        onCommit={onCommit}
      />
    </div>
  );
}

export function BudgetSetup({ setup }: { setup: SetupPage }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [income, setIncome] = useState(setup.incomeCents);
  const [amounts, setAmounts] = useState<Record<number, number>>(() =>
    Object.fromEntries(setup.rows.map((r) => [r.categoryId, r.suggestedCents])),
  );
  const [showUnused, setShowUnused] = useState(false);

  const leftToAssign =
    income - Object.values(amounts).reduce((s, n) => s + n, 0);

  const groups = useMemo(() => {
    const byParent = new Map<
      number,
      { parentId: number; parentName: string; color: string; rows: SetupRow[] }
    >();
    for (const row of setup.rows) {
      if (!row.hasHistory) continue;
      const g = byParent.get(row.parentId) ?? {
        parentId: row.parentId,
        parentName: row.parentName,
        color: row.color,
        rows: [],
      };
      g.rows.push(row);
      byParent.set(row.parentId, g);
    }
    return [...byParent.values()];
  }, [setup.rows]);

  const unused = setup.rows.filter((r) => !r.hasHistory);

  function setAmount(categoryId: number, cents: number) {
    setAmounts((a) => ({ ...a, [categoryId]: cents }));
  }

  function save() {
    start(async () => {
      const rows = Object.entries(amounts).map(([categoryId, amountCents]) => ({
        categoryId: Number(categoryId),
        amountCents,
      }));
      const r = await saveBudget({
        month: setup.month,
        incomeCents: income,
        rows,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Something went wrong");
        return;
      }
      toast.success("Budget saved");
      router.push(`/budget?month=${setup.month}`);
    });
  }

  return (
    <div className="grid gap-6">
      <div className="sticky top-0 z-10 flex items-center gap-6 rounded-card bg-canvas/90 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-body">
          <span className="text-ink-2">Expected income</span>
          <AmountField
            cents={income}
            ariaLabel="Expected income"
            onCommit={(c) => setIncome(c)}
            className="w-28"
          />
        </div>
        <div className="flex items-center gap-2 text-body">
          <span className="text-ink-2">Left to assign</span>
          <span
            className={cn(
              "tnum font-semibold",
              leftToAssign < 0 && "text-negative",
            )}
          >
            {formatCents(leftToAssign)}
          </span>
        </div>
        <Button className="ml-auto" disabled={pending} onClick={save}>
          Save budget
        </Button>
      </div>

      {setup.avgMonths === 0 && (
        <p className="text-caption text-ink-2">
          No complete months to average yet — amounts start at zero.
        </p>
      )}

      {(setup.uncategorizedSpendCents > 0 ||
        setup.uncategorizedIncomeCents > 0) && (
        <p className="text-caption text-ink-2">
          Uncategorized activity averaged{" "}
          {setup.uncategorizedSpendCents > 0 &&
            `${formatCents(setup.uncategorizedSpendCents, { sign: "never" })}/mo out`}
          {setup.uncategorizedSpendCents > 0 &&
            setup.uncategorizedIncomeCents > 0 &&
            " and "}
          {setup.uncategorizedIncomeCents > 0 &&
            `${formatCents(setup.uncategorizedIncomeCents, { sign: "never" })}/mo in`}{" "}
          during this window —{" "}
          <Link href="/review" className="text-accent">
            review it
          </Link>{" "}
          to improve these suggestions.
        </p>
      )}

      {groups.map((g) => (
        <Card key={g.parentId}>
          <h2 className="mb-1 flex items-center gap-2 text-headline font-semibold">
            <span
              className="size-2.5 rounded-pill"
              style={{ backgroundColor: g.color }}
            />
            {g.parentName}
          </h2>
          <div className="grid">
            {g.rows.map((row) => (
              <SetupRowLine
                key={row.categoryId}
                row={row}
                amount={amounts[row.categoryId] ?? 0}
                onCommit={(cents) => setAmount(row.categoryId, cents)}
              />
            ))}
          </div>
        </Card>
      ))}

      {unused.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowUnused((s) => !s)}
            className="text-caption text-accent"
          >
            {showUnused
              ? "Hide unused categories"
              : `Show ${unused.length} unused categories`}
          </button>
          {showUnused && (
            <Card className="mt-3">
              <div className="grid">
                {unused.map((row) => (
                  <SetupRowLine
                    key={row.categoryId}
                    row={row}
                    amount={amounts[row.categoryId] ?? 0}
                    onCommit={(cents) => setAmount(row.categoryId, cents)}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
