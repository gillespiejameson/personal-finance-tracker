import Link from "next/link";
import { AmountText } from "@/components/finance/AmountText";
import { Card } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import { weekStart } from "@/lib/ritual/weeks";
import type { WallSummary } from "@/lib/wall/types";

/** Presentation only: the wall never derives a date, it only words the ones it is given. */
const longDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${iso}T00:00:00`));

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(`${iso}T00:00:00`),
  );

/** "Mon 8" — en-US puts a bare weekday+day the other way round, so compose it. */
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
    d,
  );
  return `${weekday} ${d.getDate()}`;
};

/** A whole block is one target; nothing inside it is interactive. */
function Block({
  href,
  label,
  className,
  children,
}: {
  href: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={className} prefetch={false}>
      <Card className="flex h-full flex-col gap-2 overflow-hidden">
        <div className="text-caption font-medium uppercase tracking-wide text-ink-2">
          {label}
        </div>
        {children}
      </Card>
    </Link>
  );
}

/**
 * `gateOpen` tells a closed budget gate apart from a month with no budget --
 * both null out `safeToSpend` and `budget`, but they need different wording.
 */
export function WallPanel({ summary }: { summary: WallSummary }) {
  const safe = summary.safeToSpend;
  const budget = summary.budget;
  const gateShut = !summary.gateOpen;
  const due = summary.bills.due;
  const spentShare = budget
    ? Math.min(
        100,
        (budget.spentCents / Math.max(1, budget.budgetedCents)) * 100,
      )
    : 0;
  const over = budget ? budget.spentCents > budget.budgetedCents : false;
  return (
    <div className="grid h-screen grid-rows-[auto_1fr] gap-6 bg-canvas p-10">
      <header className="flex items-baseline justify-between">
        <h1 className="text-title font-semibold text-ink">
          {longDate(summary.today)}
        </h1>
        <p className="text-headline text-ink-2">
          Week of {shortDate(weekStart(summary.today))}
        </p>
      </header>
      <div className="grid grid-cols-12 grid-rows-[3fr_2fr] gap-6">
        <Block href="/budget" label="Safe to spend" className="col-span-5">
          {safe ? (
            <>
              <div className="flex items-baseline gap-3">
                <AmountText
                  cents={safe.perDayCents}
                  sign="never"
                  colorize={false}
                  size="display"
                  className="font-semibold"
                />
                <span className="text-headline text-ink-2">per day</span>
              </div>
              <p className="text-caption text-ink-2">
                {formatCents(safe.totalCents, { sign: "never" })}{" "}
                {safe.horizonLabel} &middot; {shortDate(safe.untilDate)}
              </p>
            </>
          ) : (
            <p className="text-headline text-ink-2">
              {gateShut
                ? "Budget unlocks after 2 months of data"
                : "No budget this month"}
            </p>
          )}
        </Block>
        <Block href="/bills" label="Bills this week" className="col-span-7">
          {due.length === 0 ? (
            <p className="text-headline text-ink-2">No bills this week</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {due.slice(0, 8).map((b, i) => (
                  <li
                    key={`${i}-${b.name}`}
                    className="flex items-center gap-3 text-body"
                  >
                    <span
                      className="size-2 shrink-0 rounded-pill bg-subtle"
                      style={
                        b.categoryColor
                          ? { backgroundColor: b.categoryColor }
                          : undefined
                      }
                    />
                    <span
                      className={`min-w-0 flex-1 truncate ${b.overdue ? "text-negative" : "text-ink"}`}
                    >
                      {b.name}
                    </span>
                    <span
                      className={`shrink-0 text-caption ${b.overdue ? "text-negative" : "text-ink-2"}`}
                    >
                      {b.overdue ? "overdue" : dayLabel(b.expectedDate)}
                    </span>
                    <AmountText
                      cents={Math.abs(b.cents)}
                      sign="never"
                      colorize={false}
                      className="w-24 shrink-0 text-right font-medium"
                    />
                  </li>
                ))}
                {due.length > 8 && (
                  <li className="text-caption text-ink-2">
                    +{due.length - 8} more
                  </li>
                )}
              </ul>
              <p className="mt-auto text-caption text-ink-2">
                {due.length} due &middot;{" "}
                {formatCents(summary.bills.dueTotalCents, { sign: "never" })}
              </p>
            </>
          )}
        </Block>
        <Block href="/review" label="To review" className="col-span-3">
          <div className="tnum text-title font-semibold text-ink">
            {summary.review.count}
          </div>
          <p className="text-caption text-ink-2">
            {summary.review.streakWeeks}-week streak
          </p>
          {summary.review.weeklyDue && (
            <p className="mt-auto flex items-center gap-2 text-caption text-negative">
              <span className="size-2 rounded-pill bg-negative" />
              review due
            </p>
          )}
        </Block>
        <Block href="/budget" label="This month" className="col-span-4">
          {budget ? (
            <>
              <p className="text-body text-ink">
                Spent {formatCents(budget.spentCents, { sign: "never" })} of{" "}
                {formatCents(budget.budgetedCents, { sign: "never" })}
              </p>
              <div className="relative mt-auto h-3 w-full overflow-hidden rounded-pill bg-subtle">
                <div
                  className={`h-full rounded-pill ${over ? "bg-negative" : "bg-accent"}`}
                  style={{ width: `${spentShare}%` }}
                />
                <span
                  className="absolute inset-y-0 w-px bg-ink-2"
                  style={{
                    left: `${Math.min(100, budget.elapsedShare * 100)}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <p className="text-body text-ink-2">
              {gateShut
                ? "Budget unlocks after 2 months of data"
                : "Nothing budgeted yet"}
            </p>
          )}
        </Block>
        <Block href="/bills" label="Next planned" className="col-span-3">
          {summary.nextPlanned ? (
            <>
              <p className="truncate text-body font-medium text-ink">
                {summary.nextPlanned.name}
              </p>
              <AmountText
                cents={Math.abs(summary.nextPlanned.cents)}
                sign="never"
                colorize={false}
                size="headline"
                className="font-semibold"
              />
              <p className="mt-auto text-caption text-ink-2">
                {shortDate(summary.nextPlanned.date)}
              </p>
            </>
          ) : (
            <p className="text-body text-ink-2">Nothing planned</p>
          )}
        </Block>
        <Block href="/alerts" label="Worth a look" className="col-span-2">
          {summary.alerts.count > 0 ? (
            <>
              <div className="tnum text-title font-semibold text-ink">
                {summary.alerts.count}
              </div>
              <p className="text-caption text-ink-2">worth a look</p>
            </>
          ) : (
            <p className="text-body text-ink-2">Nothing to look at</p>
          )}
        </Block>
      </div>
    </div>
  );
}
