"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { shiftMonth } from "@/lib/insights/page";

const label = (m: string) =>
  new Date(`${m}-15T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

export function MonthPicker({
  month,
  months,
  basePath,
  extraParams = {},
}: {
  month: string;
  months: string[];
  basePath: string;
  /** Query params to carry along, so a sibling picker's choice survives. */
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();
  const min = months[0] ?? month;
  const max = months[months.length - 1] ?? month;
  const go = (m: string) =>
    router.push(
      `${basePath}?${new URLSearchParams({ month: m, ...extraParams })}`,
    );
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Previous month"
        disabled={month <= min}
        onClick={() => go(shiftMonth(month, -1))}
        className="rounded-pill p-1.5 text-ink-2 hover:bg-subtle disabled:opacity-30"
      >
        <ChevronLeft className="size-5" />
      </button>
      <span className="min-w-40 text-center text-headline font-semibold">
        {label(month)}
      </span>
      <button
        type="button"
        aria-label="Next month"
        disabled={month >= max}
        onClick={() => go(shiftMonth(month, 1))}
        className="rounded-pill p-1.5 text-ink-2 hover:bg-subtle disabled:opacity-30"
      >
        <ChevronRight className="size-5" />
      </button>
    </div>
  );
}
