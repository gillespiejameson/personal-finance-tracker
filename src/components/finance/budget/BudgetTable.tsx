"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  copyBudget,
  setBudgetAmount,
  setBudgetIncome,
  setCategoryRollover,
} from "@/actions/budget";
import { AmountText } from "@/components/finance/AmountText";
import { AmountField } from "@/components/finance/budget/AmountField";
import { BudgetStrip } from "@/components/finance/budget/BudgetStrip";
import { SafeToSpendCard } from "@/components/finance/budget/SafeToSpendCard";
import { SetAsideCard } from "@/components/finance/spreading/SetAsideCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { roundUp10 } from "@/lib/budget/setup";
import type { BudgetGroup, BudgetLeaf, BudgetPage } from "@/lib/budget/types";
import { PARENT_COLORS, tint } from "@/lib/categories/palette";
import { shiftMonth } from "@/lib/insights/page";
import { formatCents } from "@/lib/money";
import { leafTransactionsHref } from "@/lib/transactions/links";
import { cn } from "@/lib/utils";

type RunFn = <R extends { ok: boolean; error?: string }>(
  fn: () => Promise<R>,
  done?: (r: Extract<R, { ok: true }>) => string,
) => void;

const ROW_GRID = "grid-cols-[1fr_130px_120px_130px_90px]";

function pillLabel(leaf: BudgetLeaf): string {
  if (leaf.goalId !== null) return "goal";
  return leaf.isFixed ? "fixed" : "variable";
}

function carryCaption(leaf: BudgetLeaf): string | null {
  if (leaf.carry === 0) return null;
  return leaf.carry > 0
    ? `incl. +${formatCents(leaf.carry, { sign: "never" })} rolled over`
    : `incl. −${formatCents(Math.abs(leaf.carry), { sign: "never" })} from last month`;
}

function setAsideCaption(
  leaf: BudgetLeaf,
): { text: string; warn: boolean } | null {
  if (!leaf.setAside || leaf.setAside.names.length === 0) return null;
  const amount = formatCents(leaf.setAside.cents, { sign: "never" });
  const names = leaf.setAside.names.join(", ");
  if (leaf.budgeted >= leaf.setAside.cents)
    return { text: `incl. ${amount}/mo set aside for ${names}`, warn: false };
  return { text: `needs ${amount}/mo set aside for ${names}`, warn: true };
}

function LeafRow({
  leaf,
  month,
  run,
  amountCents,
  unbudgeted = false,
}: {
  leaf: BudgetLeaf;
  month: string;
  run: RunFn;
  amountCents: number;
  unbudgeted?: boolean;
}) {
  const caption = carryCaption(leaf);
  const setAside = setAsideCaption(leaf);
  return (
    <div
      id={`leaf-${leaf.id}`}
      className={cn(
        "grid items-center gap-3 border-b border-line px-5 py-3",
        ROW_GRID,
      )}
      style={
        leaf.status === "over"
          ? { backgroundColor: tint(PARENT_COLORS.health, 0.08) }
          : undefined
      }
    >
      <div className="flex min-w-0 items-center gap-2 text-body font-medium">
        <span className="truncate">{leaf.name}</span>
        <span className="rounded-pill bg-subtle px-1.5 text-micro text-ink-3">
          {pillLabel(leaf)}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={leaf.rollover}
          aria-label={`Rollover for ${leaf.name}`}
          onClick={() =>
            run(() =>
              setCategoryRollover({ id: leaf.id, rollover: !leaf.rollover }),
            )
          }
          className={cn(
            "shrink-0 rounded-pill px-2 py-0.5 text-micro font-medium",
            leaf.rollover ? "bg-accent/15 text-accent" : "bg-subtle text-ink-3",
          )}
        >
          Rollover
        </button>
      </div>
      {unbudgeted ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            run(
              () =>
                setBudgetAmount({
                  month,
                  categoryId: leaf.id,
                  amountCents: roundUp10(leaf.spent),
                }),
              () => "Budget added",
            )
          }
        >
          Add budget
        </Button>
      ) : (
        <AmountField
          cents={amountCents}
          ariaLabel={`Budgeted for ${leaf.name}`}
          onCommit={(cents) =>
            run(() =>
              setBudgetAmount({
                month,
                categoryId: leaf.id,
                amountCents: cents,
              }),
            )
          }
        />
      )}
      <span className="text-right">
        <Link
          href={leafTransactionsHref(leaf.id, month)}
          className="rounded-sm hover:text-accent hover:underline"
        >
          <AmountText cents={leaf.spent} sign="never" colorize={false} />
        </Link>
      </span>
      <div className="text-right">
        <AmountText
          cents={leaf.remaining}
          colorize={false}
          className={leaf.remaining < 0 ? "text-negative" : "text-ink"}
        />
        {caption && <div className="text-micro text-ink-3">{caption}</div>}
        {setAside && (
          <div
            className={cn(
              "text-micro",
              setAside.warn ? "text-warning" : "text-ink-3",
            )}
          >
            {setAside.text}
          </div>
        )}
      </div>
      <div className="flex items-center">
        <div className="h-1.5 w-full overflow-hidden rounded-pill bg-subtle">
          <div
            className={cn(
              "h-full rounded-pill",
              leaf.status === "over" && "bg-negative",
              leaf.status === "warn" && "bg-warning",
            )}
            style={{
              width: `${leaf.fill * 100}%`,
              backgroundColor: leaf.status === "ok" ? leaf.color : undefined,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function GroupHeader({ group }: { group: BudgetGroup }) {
  return (
    <div
      className={cn(
        "grid items-center gap-3 bg-subtle/60 px-5 py-2 text-caption font-medium text-ink-2",
        ROW_GRID,
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className="size-2.5 rounded-pill"
          style={{ backgroundColor: group.color }}
        />
        {group.parentName}
      </span>
      <AmountText
        cents={group.budgeted}
        sign="never"
        colorize={false}
        className="text-right"
      />
      <AmountText
        cents={group.spent}
        sign="never"
        colorize={false}
        className="text-right"
      />
      <AmountText
        cents={group.remaining}
        colorize={false}
        className={cn("text-right", group.remaining < 0 && "text-negative")}
      />
      <span />
    </div>
  );
}

export function CopyLastMonthButton({ month }: { month: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await copyBudget({
            from: shiftMonth(month, -1),
            to: month,
          });
          if (!r.ok) {
            toast.error(r.error ?? "Something went wrong");
            return;
          }
          toast.success(`${r.copied} categories copied`);
          router.refresh();
        })
      }
    >
      Copy last month
    </Button>
  );
}

export function BudgetTable({ page }: { page: BudgetPage }) {
  const router = useRouter();
  const [pending, start] = useTransition();
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

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-end gap-4">
        {!page.nextHasBudget && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  copyBudget({
                    from: page.month,
                    to: shiftMonth(page.month, 1),
                  }),
                (r) => `${r.copied} categories copied to next month`,
              )
            }
          >
            Copy to next month
          </Button>
        )}
        <Link
          href={`/budget/setup?month=${page.month}`}
          className="text-caption text-accent"
        >
          Redo setup
        </Link>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <Card className="col-span-4">
          <div className="text-caption text-ink-2">Left to assign</div>
          <AmountText
            cents={page.leftToAssignCents}
            colorize={false}
            size="display"
            className={cn(
              "font-semibold",
              page.leftToAssignCents < 0 && "text-negative",
            )}
          />
          {page.leftToAssignCents < 0 && (
            <div className="text-caption text-negative">over-assigned</div>
          )}
          <div className="mt-1 flex items-center gap-1 text-caption text-ink-2">
            of
            <AmountField
              cents={page.incomeCents}
              ariaLabel="Expected income"
              onCommit={(cents) =>
                run(() => setBudgetIncome({ month: page.month, cents }))
              }
              className="w-24"
            />
          </div>
        </Card>
        <Card className="col-span-4">
          <div className="text-caption text-ink-2">
            Spent in budgeted categories
          </div>
          <div className="flex items-baseline gap-2">
            <AmountText
              cents={page.spentCents}
              sign="never"
              colorize={false}
              size="display"
              className="font-semibold"
            />
            <span className="tnum text-body text-ink-2">
              of {formatCents(page.budgetedCents, { sign: "never" })}
            </span>
          </div>
          {page.uncategorizedCents > 0 && (
            <div className="text-caption text-ink-2">
              + {formatCents(page.uncategorizedCents, { sign: "never" })}{" "}
              uncategorized ·{" "}
              <Link href="/review" className="text-accent">
                review
              </Link>
            </div>
          )}
        </Card>
        {page.safeToSpend ? (
          <SafeToSpendCard
            safe={page.safeToSpend}
            payday={page.payday}
            className="col-span-4"
          />
        ) : (
          <Card className="col-span-4">
            <div className="text-caption text-ink-2">Safe to spend</div>
            <p className="mt-2 text-body text-ink-2">
              Safe to spend appears for the current month
            </p>
          </Card>
        )}
      </div>

      <BudgetStrip strip={page.strip} />

      {page.setAside.length > 0 && <SetAsideCard items={page.setAside} />}

      {page.overspent.length > 0 && (
        <section className="overflow-hidden rounded-card bg-card shadow-card">
          <div className="border-b border-line px-5 py-3 text-headline font-semibold text-negative">
            Overspent
          </div>
          <div className="grid gap-2 px-5 py-3">
            {page.overspent.map((leaf) => (
              <a
                key={leaf.id}
                href={`#leaf-${leaf.id}`}
                className="flex items-center justify-between gap-3 text-body hover:underline"
              >
                <span className="min-w-0 truncate">
                  {leaf.name}{" "}
                  <span className="text-caption text-ink-3">
                    · {leaf.parentName}
                  </span>
                </span>
                <AmountText
                  cents={leaf.remaining}
                  colorize={false}
                  className="shrink-0 text-negative"
                />
              </a>
            ))}
          </div>
        </section>
      )}

      {page.groups.map((group) => (
        <section
          key={group.parentId}
          className="overflow-hidden rounded-card bg-card shadow-card"
        >
          <GroupHeader group={group} />
          {group.leaves.map((leaf) => (
            <LeafRow
              key={leaf.id}
              leaf={leaf}
              month={page.month}
              run={run}
              amountCents={leaf.budgeted}
            />
          ))}
        </section>
      ))}

      {page.unbudgeted.length > 0 && (
        <section className="overflow-hidden rounded-card bg-card shadow-card">
          <div className="border-b border-line px-5 py-3 text-headline font-semibold">
            Unbudgeted
          </div>
          {page.unbudgeted.map((leaf) => (
            <LeafRow
              key={leaf.id}
              leaf={leaf}
              month={page.month}
              run={run}
              amountCents={leaf.spent}
              unbudgeted
            />
          ))}
        </section>
      )}

      {page.uncategorizedCents > 0 && (
        <div className="text-caption text-ink-2">
          Uncategorized{" "}
          {formatCents(page.uncategorizedCents, { sign: "never" })} ·{" "}
          <Link href="/review" className="text-accent">
            review
          </Link>
        </div>
      )}
    </div>
  );
}
