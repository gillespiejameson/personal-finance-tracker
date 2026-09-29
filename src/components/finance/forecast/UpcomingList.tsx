import { AmountText } from "@/components/finance/AmountText";
import type { ForecastEvent } from "@/lib/forecast/types";
import { formatCents } from "@/lib/money";

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

export function UpcomingList({
  events,
}: {
  events: (ForecastEvent & { afterCents: number })[];
}) {
  if (events.length === 0) {
    return (
      <p className="text-caption text-ink-2">
        No income, bills or planned expenses in this window.
      </p>
    );
  }
  return (
    <ul className="flex flex-col">
      {events.map((e) => (
        <li
          key={`${e.date}-${e.kind}-${e.name}`}
          className="grid grid-cols-[90px_1fr_auto_auto] items-center gap-4 border-b border-line py-3 text-caption last:border-b-0"
        >
          <span className="tnum text-ink-2">{shortDate(e.date)}</span>
          <span className="truncate text-ink">{e.name}</span>
          <AmountText
            cents={e.amountCents}
            colorize={e.kind === "income"}
            className="text-right font-medium"
          />
          <span className="tnum text-right text-ink-2">
            {formatCents(e.afterCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}
