import type { Strip } from "@/lib/budget/types";
import { PARENT_COLORS } from "@/lib/categories/palette";

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function BudgetStrip({ strip }: { strip: Strip }) {
  const needs = clamp01(strip.needsPct);
  const wants = clamp01(strip.wantsPct);
  const save = clamp01(strip.savePct);
  const sum = needs + wants + save;
  const scale = sum > 1 ? 1 / sum : 1;
  const pct = (n: number) => Math.round(n * 100);
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-pill bg-subtle">
        <div
          style={{
            width: `${needs * scale * 100}%`,
            backgroundColor: PARENT_COLORS.home,
          }}
          title="Needs"
        />
        <div
          style={{
            width: `${wants * scale * 100}%`,
            backgroundColor: PARENT_COLORS.food,
          }}
          title="Wants"
        />
        <div
          style={{
            width: `${save * scale * 100}%`,
            backgroundColor: PARENT_COLORS.savings,
          }}
          title="Savings"
        />
      </div>
      <div className="mt-2 text-caption text-ink-2">
        Needs {pct(strip.needsPct)}% · Wants {pct(strip.wantsPct)}% · Savings{" "}
        {pct(strip.savePct)}% — guide: 50 / 30 / 20
      </div>
    </div>
  );
}
