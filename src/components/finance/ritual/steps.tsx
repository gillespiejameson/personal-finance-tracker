import Link from "next/link";
import type { CategoryOption, ReviewItem, Suggestion } from "@/actions/review";
import { AmountText } from "@/components/finance/AmountText";
import { ReviewScreen } from "@/components/finance/ReviewScreen";
import { SyncButton } from "@/components/finance/simplefin/SyncButton";
import { Card } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import type {
  AccountImportRow,
  BillRow,
  Pace,
  PaceLeaf,
  Staleness,
  WeeklyPage,
} from "@/lib/ritual/types";
import { relativeSince } from "@/lib/simplefin/relative";
import { cn } from "@/lib/utils";

const LINK_BUTTON =
  "inline-block rounded-control bg-accent px-5 py-2.5 text-body font-medium text-white";

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

const monthName = (month: string) =>
  new Date(`${month}-15T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
  });

const STALENESS_LABEL: Record<Staleness, string> = {
  fresh: "Fresh",
  aging: "Aging",
  stale: "Stale",
  never: "Never imported",
};
const STALENESS_TEXT: Record<Staleness, string> = {
  fresh: "text-positive",
  aging: "text-warning",
  stale: "text-negative",
  never: "text-negative",
};

export function ImportStep({ accounts }: { accounts: AccountImportRow[] }) {
  const anyLinked = accounts.some((a) => a.syncedAt !== null);
  const now = new Date();
  return (
    <Card>
      <h2 className="text-headline font-semibold">Import</h2>
      <p className="mt-1 text-body text-ink-2">
        {anyLinked
          ? "Linked accounts sync themselves; the rest need a statement."
          : "Statements from the last week keep everything else honest."}
      </p>
      <div className="mt-4 grid gap-2">
        {accounts.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-3 rounded-control border border-line px-4 py-3"
          >
            <span
              className="size-2.5 shrink-0 rounded-pill"
              style={{ backgroundColor: a.color }}
            />
            <span className="min-w-0 flex-1 truncate text-body font-medium">
              {a.name}
            </span>
            <span className="text-caption text-ink-2">
              {a.syncedAt !== null
                ? `synced ${relativeSince(a.syncedAt, now)}`
                : a.lastImport === null
                  ? "never"
                  : a.daysSince === 0
                    ? "imported today"
                    : `last import ${a.daysSince} day${a.daysSince === 1 ? "" : "s"} ago`}
            </span>
            <span
              className={cn(
                "rounded-pill bg-subtle px-2 py-0.5 text-micro font-semibold",
                STALENESS_TEXT[a.staleness],
              )}
            >
              {STALENESS_LABEL[a.staleness]}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href="/import" className={LINK_BUTTON}>
          Import statements
        </Link>
        {anyLinked && <SyncButton />}
      </div>
    </Card>
  );
}

export type ReviewData = {
  items: ReviewItem[];
  suggestions: Record<number, Suggestion[]>;
  count: number;
  categories: CategoryOption[];
} | null;

export function QueueStep({
  review,
  queueCount,
}: {
  review: ReviewData;
  queueCount: number;
}) {
  if (!review) {
    if (queueCount === 0) {
      return (
        <Card className="text-center">
          <div className="text-title font-semibold">All clear.</div>
        </Card>
      );
    }
    return (
      <Card className="text-center">
        <p className="text-body text-ink-2">Loading the queue…</p>
        <Link
          href="/weekly?step=2"
          className="mt-2 inline-block text-caption text-accent"
        >
          Reload
        </Link>
      </Card>
    );
  }
  return (
    <ReviewScreen
      items={review.items}
      suggestions={review.suggestions}
      count={review.count}
      categories={review.categories}
    />
  );
}

function PaceLeafRow({ leaf, over }: { leaf: PaceLeaf; over: boolean }) {
  return (
    <Link
      href={`/budget#leaf-${leaf.id}`}
      className="flex items-center justify-between gap-3 text-body hover:underline"
    >
      <span className="min-w-0 truncate">
        {leaf.name}{" "}
        <span className="text-caption text-ink-3">· {leaf.parentName}</span>
      </span>
      {over ? (
        <span className="tnum shrink-0 text-negative">
          over by {formatCents(-leaf.remaining, { sign: "never" })}
        </span>
      ) : (
        <AmountText
          cents={leaf.remaining}
          colorize={false}
          className="shrink-0 text-ink"
        />
      )}
    </Link>
  );
}

export function PaceStep({
  pace,
  overspent,
  warn,
  gateOpen,
  hasBudget,
  month,
  alertCount,
}: {
  pace: Pace;
  overspent: PaceLeaf[];
  warn: PaceLeaf[];
  gateOpen: boolean;
  hasBudget: boolean;
  month: string;
  alertCount: number;
}) {
  const elapsedPct = Math.round(pace.elapsed * 100);
  const usedPct = Math.round(pace.used * 100);
  const referenceLabel =
    pace.reference === "budget" ? "of your budget" : "of your usual spending";
  const statusText =
    pace.status === "ahead"
      ? "Ahead of the month."
      : pace.status === "behind"
        ? "Under pace."
        : "On pace.";
  const statusColor =
    pace.status === "ahead"
      ? "text-warning"
      : pace.status === "behind"
        ? "text-positive"
        : "text-ink-2";
  const showSetupLink = !hasBudget && gateOpen;
  return (
    <Card>
      <h2 className="text-headline font-semibold">Overspend and pace</h2>
      {pace.reference === "none" ? (
        <div className="mt-2">
          <p className="text-body text-ink-2">
            Not enough spending history yet to gauge your pace this month.
          </p>
          {showSetupLink && (
            <Link href="/budget/setup" className="text-caption text-accent">
              Set up your budget
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-body text-ink">
            You&apos;re <span className="tnum font-medium">{elapsedPct}%</span>{" "}
            through {monthName(month)} and have used{" "}
            <span className="tnum font-medium">{usedPct}%</span>{" "}
            {referenceLabel}.
          </p>
          <p className={cn("mt-1 text-body font-medium", statusColor)}>
            {statusText}
          </p>
          {showSetupLink && (
            <Link
              href="/budget/setup"
              className="mt-1 inline-block text-caption text-accent"
            >
              Set up your budget
            </Link>
          )}
        </div>
      )}
      {overspent.length > 0 && (
        <div className="mt-4">
          <div className="text-caption font-semibold text-negative">
            Overspent
          </div>
          <div className="mt-2 grid gap-2">
            {overspent.map((l) => (
              <PaceLeafRow key={l.id} leaf={l} over />
            ))}
          </div>
        </div>
      )}
      {warn.length > 0 && (
        <div className="mt-4">
          <div className="text-caption font-semibold text-warning">
            Close to the limit
          </div>
          <div className="mt-2 grid gap-2">
            {warn.map((l) => (
              <PaceLeafRow key={l.id} leaf={l} over={false} />
            ))}
          </div>
        </div>
      )}
      {alertCount > 0 && (
        <Link href="/alerts" className="mt-4 block text-caption text-accent">
          {alertCount} thing{alertCount === 1 ? "" : "s"} worth a look
        </Link>
      )}
    </Card>
  );
}

function billDue(b: BillRow): string {
  if (b.overdue) {
    const n = -b.dueInDays;
    return `overdue by ${n} day${n === 1 ? "" : "s"}`;
  }
  if (b.dueInDays === 0) return "due today";
  return `due in ${b.dueInDays} day${b.dueInDays === 1 ? "" : "s"}`;
}

export function BillsStep({ bills }: { bills: BillRow[] }) {
  return (
    <Card>
      <h2 className="text-headline font-semibold">Bills due</h2>
      {bills.length === 0 ? (
        <p className="mt-2 text-body text-ink-2">Nothing due this week.</p>
      ) : (
        <div className="mt-4 grid gap-2">
          {bills.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-control border border-line px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-body font-medium">
                  {b.merchant}
                </div>
                <div
                  className={cn(
                    "text-caption",
                    b.overdue ? "text-negative" : "text-ink-2",
                  )}
                >
                  {billDue(b)}
                </div>
              </div>
              <AmountText
                cents={b.amountCents}
                sign="never"
                colorize={false}
                className="shrink-0"
              />
            </div>
          ))}
        </div>
      )}
      <Link
        href="/bills"
        className="mt-4 inline-block text-caption text-accent"
      >
        Open bills
      </Link>
    </Card>
  );
}

export function AdjustStep({
  budgetLeftToAssign,
  goals,
}: {
  budgetLeftToAssign: number | null;
  goals: WeeklyPage["goals"];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <div className="text-caption text-ink-2">Budget</div>
        {budgetLeftToAssign === null ? (
          <p className="mt-2 text-body text-ink-2">No budget yet</p>
        ) : (
          <p className="mt-2 text-body text-ink">
            Left to assign{" "}
            <AmountText
              cents={budgetLeftToAssign}
              colorize={false}
              className={cn(
                "font-semibold",
                budgetLeftToAssign < 0 && "text-negative",
              )}
            />
          </p>
        )}
        <Link href="/budget" className="mt-3 block text-caption text-accent">
          Open budget
        </Link>
      </Card>
      <Card>
        <div className="text-caption text-ink-2">Goals</div>
        <div className="mt-2 text-headline font-semibold">
          <span className="tnum">{goals.count}</span> goal
          {goals.count === 1 ? "" : "s"}
        </div>
        {goals.nearest && (
          <p className="mt-1 text-caption text-ink-2">
            {goals.nearest.name} ·{" "}
            <span className="tnum">{Math.round(goals.nearest.pct * 100)}%</span>{" "}
            · by {shortDate(goals.nearest.targetDate)}
          </p>
        )}
        <Link href="/goals" className="mt-3 block text-caption text-accent">
          Open goals
        </Link>
      </Card>
      <Card>
        <div className="text-caption text-ink-2">Rules and categories</div>
        <p className="mt-2 text-body text-ink-2">
          Fine-tune how transactions get sorted automatically.
        </p>
        <Link href="/settings" className="mt-3 block text-caption text-accent">
          Open settings
        </Link>
      </Card>
    </div>
  );
}
