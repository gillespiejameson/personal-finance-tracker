"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import type { WaterfallStep } from "@/lib/insights/cashflow";
import { formatCents } from "@/lib/money";

export function CashFlowWaterfall({
  steps,
  colors,
}: {
  steps: WaterfallStep[];
  colors: { positive: string; negative: string; neutral: string };
}) {
  const data = steps.map((s) => ({
    label: s.label,
    base: Math.min(s.start, s.end),
    value: Math.abs(s.delta),
    delta: s.delta,
  }));
  const reduce = useReducedMotion();
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid
            horizontal
            vertical={false}
            stroke="var(--color-line)"
          />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis hide />
          <ReferenceLine y={0} stroke="var(--color-line)" />
          <Tooltip
            formatter={(v, name) =>
              name === "value"
                ? formatCents(Number(v), { sign: "never" })
                : null
            }
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--color-line)",
            }}
          />
          <Bar
            dataKey="base"
            stackId="w"
            fill="transparent"
            isAnimationActive={false}
          />
          <Bar
            dataKey="value"
            stackId="w"
            radius={[8, 8, 8, 8]}
            isAnimationActive={!reduce}
          >
            {data.map((d) => (
              <Cell
                key={d.label}
                fill={
                  d.label === "Leftover"
                    ? colors.neutral
                    : d.delta >= 0
                      ? colors.positive
                      : colors.negative
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
