import Link from "next/link";
import { AmountText } from "@/components/finance/AmountText";
import { Card } from "@/components/ui/card";
import type { ResolvedPayday, SafeToSpend } from "@/lib/budget/types";
import { formatCents } from "@/lib/money";

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
const monthName = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long" });

export function SafeToSpendCard({
  safe,
  payday,
  compact = false,
  className,
  dipNote,
}: {
  safe: SafeToSpend;
  payday: ResolvedPayday;
  compact?: boolean;
  className?: string;
  dipNote?: { cents: number; date: string };
}) {
  const horizon =
    safe.horizonKind === "payday"
      ? `until payday · ${longDate(safe.horizon)}`
      : `until month end · ${longDate(safe.horizon)}`;
  return (
    <Card className={className}>
      <div className="text-caption text-ink-2">Safe to spend</div>
      <div className="flex items-baseline gap-2">
        <AmountText
          cents={safe.perDayCents}
          sign="never"
          colorize={false}
          size="display"
          className="font-semibold"
        />
        <span className="text-body text-ink-2">per day</span>
      </div>
      <div className="tnum mt-1 text-caption text-ink-2">
        {formatCents(safe.totalCents, { sign: "never" })} {horizon} (
        {safe.daysUntil} day{safe.daysUntil === 1 ? "" : "s"})
      </div>
      {safe.restOfMonth && (
        <div className="tnum mt-1 text-caption text-ink-2">
          {formatCents(safe.restOfMonth.perDayCents, { sign: "never" })} per day
          for the rest of {monthName(safe.restOfMonth.horizon)} ·{" "}
          {formatCents(safe.restOfMonth.totalCents, { sign: "never" })} over{" "}
          {safe.restOfMonth.daysUntil} day
          {safe.restOfMonth.daysUntil === 1 ? "" : "s"}
        </div>
      )}
      {!compact && (
        <div className="tnum mt-3 text-micro text-ink-3">
          Variable budgets remaining {formatCents(safe.variableRemainingCents)}{" "}
          − bills due before then{" "}
          {formatCents(safe.unpostedBillsCents, { sign: "never" })}
          {payday?.inferred && (
            <>
              {" "}
              · payday inferred from your paycheck,{" "}
              <Link href="/settings" className="text-accent">
                change
              </Link>
            </>
          )}
        </div>
      )}
      {dipNote && (
        <div className="tnum mt-2 text-caption text-negative">
          Cash dips to {formatCents(dipNote.cents)} on {longDate(dipNote.date)}{" "}
          ·{" "}
          <Link href="/forecast" className="text-accent">
            View forecast
          </Link>
        </div>
      )}
    </Card>
  );
}
