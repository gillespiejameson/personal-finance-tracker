"use client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { formatCents } from "@/lib/money";
import type { NetWorthPoint } from "@/lib/networth/types";

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
  });
}

export function NetWorthChart({ series }: { series: NetWorthPoint[] }) {
  const reduce = useReducedMotion();

  if (series.length === 0) {
    return (
      <p className="text-caption text-ink-2">
        Add a balance to see net worth over time.
      </p>
    );
  }

  const data = series.map((p) => ({
    label: monthLabel(p.date),
    netWorthCents: p.netWorthCents,
  }));
  const values = data.map((d) => d.netWorthCents);
  const crossesZero = Math.min(...values) < 0 && Math.max(...values) > 0;

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
          {crossesZero && <ReferenceLine y={0} stroke="var(--color-line)" />}
          <Tooltip
            formatter={(v) => [formatCents(Number(v)), "Net worth"]}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--color-line)",
            }}
          />
          <Line
            type="monotone"
            dataKey="netWorthCents"
            name="Net worth"
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
