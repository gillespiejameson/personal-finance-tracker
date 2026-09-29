"use client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { formatCents } from "@/lib/money";

const MAX_POINTS = 120;

function monthLabel(month: string): string {
  return new Date(`${month}-15T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
  });
}

export function DebtChart({
  series,
}: {
  series: { month: string; remainingCents: number }[];
}) {
  const reduce = useReducedMotion();

  if (series.length === 0) {
    return (
      <p className="text-caption text-ink-2">
        Add APR and a minimum payment to at least one debt to see the payoff
        curve.
      </p>
    );
  }

  const step = Math.max(1, Math.ceil(series.length / MAX_POINTS));
  const sampled = series.filter((_, i) => i % step === 0);
  const last = series[series.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);

  const data = sampled.map((p) => ({
    label: monthLabel(p.month),
    remainingCents: p.remainingCents,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, left: 16, bottom: 0 }}
        >
          <CartesianGrid
            horizontal
            vertical={false}
            stroke="var(--color-line)"
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis hide />
          <Tooltip
            formatter={(v) => [formatCents(Number(v)), "Remaining"]}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--color-line)",
            }}
          />
          <Line
            type="monotone"
            dataKey="remainingCents"
            name="Remaining"
            stroke="var(--color-accent)"
            dot={false}
            strokeWidth={2}
            isAnimationActive={!reduce}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
