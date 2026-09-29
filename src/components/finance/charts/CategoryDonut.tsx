"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { formatCents } from "@/lib/money";

type Slice = { name: string; value: number; color: string };

export function CategoryDonut({
  slices,
  totalCents,
  activeName = null,
  onSelect,
  onHover,
}: {
  slices: Slice[];
  totalCents: number;
  /** Slice drawn with an outline (the group currently opened from the donut). */
  activeName?: string | null;
  /** Called with the slice name on click; the parent decides what "select" means. */
  onSelect?: (name: string) => void;
  /** Called with the hovered slice name, or null when the pointer leaves. */
  onHover?: (name: string | null) => void;
}) {
  const reduce = useReducedMotion();
  const data = slices.filter((s) => s.value > 0);
  // Chart height (`h-64`) less the tooltip's two lines, so it sits in the
  // bottom-left corner: clear of the center label and of the top-left arc,
  // which is where the largest slice usually starts.
  const tooltipY = 256 - 64;
  const sliceName = (d: { name?: string | number; payload?: unknown }) => {
    const payload = d.payload as { name?: unknown } | undefined;
    const n = typeof payload?.name === "string" ? payload.name : d.name;
    return typeof n === "string" ? n : null;
  };
  return (
    <div className="relative h-64 w-full">
      <ResponsiveContainer>
        {/* No keyboard layer: the svg would otherwise take focus (tabindex 0)
            on a click in the hole and draw the browser's focus rectangle
            around the whole chart. Keyboard users get the table below. */}
        <PieChart accessibilityLayer={false}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            stroke="none"
            isAnimationActive={!reduce}
            rootTabIndex={-1}
            className={onSelect ? "cursor-pointer" : undefined}
            onClick={(d) => {
              const n = sliceName(d);
              if (n !== null) onSelect?.(n);
            }}
            onMouseEnter={(d) => onHover?.(sliceName(d))}
            onMouseLeave={() => onHover?.(null)}
          >
            {data.map((s) => {
              const active = activeName !== null && s.name === activeName;
              const dimmed = activeName !== null && !active;
              return (
                <Cell
                  key={s.name}
                  fill={s.color}
                  fillOpacity={dimmed ? 0.45 : 1}
                  stroke={active ? "var(--color-ink)" : "none"}
                  strokeWidth={active ? 2 : 0}
                />
              );
            })}
          </Pie>
          <Tooltip
            formatter={(v) => formatCents(Number(v), { sign: "never" })}
            // Pinned to the bottom-left corner so it never sits over the
            // center label or the first slice.
            position={{ x: 0, y: tooltipY }}
            isAnimationActive={false}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--color-line)",
              boxShadow: "var(--shadow-float)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-caption text-ink-2">Spent</span>
        <span className="tnum text-headline font-semibold">
          {formatCents(totalCents, { sign: "never" })}
        </span>
      </div>
    </div>
  );
}
