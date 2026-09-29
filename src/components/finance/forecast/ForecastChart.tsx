"use client";
import type { DotItemDotProps, TooltipContentProps } from "recharts";
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
import { AmountText } from "@/components/finance/AmountText";
import type { ForecastEvent, ForecastPoint } from "@/lib/forecast/types";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { formatCents } from "@/lib/money";

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

type ChartPoint = {
  date: string;
  label: string;
  balanceCents: number;
  events: ForecastEvent[];
};

/** Only days with events get a visible dot; the rest render nothing. */
function EventDot(props: DotItemDotProps) {
  const { cx, cy } = props;
  const point = props.payload as ChartPoint | undefined;
  if (cx == null || cy == null || !point || point.events.length === 0)
    return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--color-accent)"
      stroke="var(--color-card)"
      strokeWidth={1.5}
    />
  );
}

function ForecastTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as ChartPoint | undefined;
  if (!point) return null;
  return (
    <div className="rounded-xl border border-line bg-card p-3 text-caption shadow-card">
      <div className="mb-1 font-medium text-ink">{shortDate(point.date)}</div>
      <div className="tnum text-ink-2">
        {formatCents(point.balanceCents)} balance
      </div>
      {point.events.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
          {point.events.map((e) => (
            <li
              key={`${e.kind}-${e.name}`}
              className="flex items-center justify-between gap-4"
            >
              <span className="text-ink-2">{e.name}</span>
              <AmountText
                cents={e.amountCents}
                colorize={e.kind === "income"}
                className="font-medium"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ForecastChart({
  points,
  floorCents,
}: {
  points: ForecastPoint[];
  floorCents: number;
}) {
  const reduce = useReducedMotion();
  const data: ChartPoint[] = points.map((p) => ({
    date: p.date,
    label: shortDate(p.date),
    balanceCents: p.balanceCents,
    events: p.events,
  }));

  return (
    <div className="h-72 w-full">
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
          <ReferenceLine
            y={floorCents}
            stroke="var(--color-negative)"
            strokeDasharray="4 4"
          />
          <Tooltip content={ForecastTooltip} />
          <Line
            type="monotone"
            dataKey="balanceCents"
            name="Balance"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={EventDot}
            isAnimationActive={!reduce}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
