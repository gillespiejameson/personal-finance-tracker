"use client";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEP_TITLES = [
  "Import",
  "Review queue",
  "Overspend and pace",
  "Bills due",
  "Adjust anything?",
] as const;

export const STEP_COUNT = STEP_TITLES.length;

export function StepRail({
  step,
  onSelect,
  queueCount,
}: {
  step: number;
  onSelect: (n: number) => void;
  queueCount: number;
}) {
  return (
    <div className="flex flex-wrap gap-2 lg:flex-col lg:flex-nowrap lg:gap-1">
      {STEP_TITLES.map((title, i) => {
        const n = i + 1;
        const current = n === step;
        const done = n < step;
        return (
          <button
            key={title}
            type="button"
            aria-current={current ? "step" : undefined}
            onClick={() => onSelect(n)}
            className={cn(
              "flex items-center gap-3 rounded-control px-3 py-2 text-left text-body font-medium text-ink-2 transition-colors hover:bg-subtle",
              current && "bg-card text-ink shadow-card",
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-pill text-micro font-semibold",
                done
                  ? "bg-accent text-white"
                  : current
                    ? "bg-accent/15 text-accent"
                    : "bg-subtle text-ink-3",
              )}
            >
              {done ? <Check className="size-3.5" /> : n}
            </span>
            <span className="flex flex-col">
              {title}
              {n === 2 && (
                <span className="tnum text-micro text-ink-3">
                  {queueCount > 0 ? `${queueCount} left` : "All clear"}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
