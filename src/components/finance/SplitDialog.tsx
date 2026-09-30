"use client";
import { useRef, useState } from "react";
import type { CategoryOption } from "@/actions/review";
import { AmountText } from "@/components/finance/AmountText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseAmountToCents } from "@/lib/money";

/** `key` is client-only: it keeps a line's row (and focus) stable while its category changes or other lines are removed. */
type Line = { key: number; categoryId: number; amount: string };
type Props = {
  totalCents: number;
  categories: CategoryOption[];
  onSave: (
    rows: { categoryId: number; amountCents: number }[],
  ) => Promise<void>;
  onClose: () => void;
};

export function SplitDialog({
  totalCents,
  categories,
  onSave,
  onClose,
}: Props) {
  const first = categories[0]?.id ?? 0;
  const nextKey = useRef(2);
  const [lines, setLines] = useState<Line[]>([
    { key: 0, categoryId: first, amount: "" },
    { key: 1, categoryId: first, amount: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const sign = Math.sign(totalCents) || -1;
  const cents = lines.map((l) => {
    const c = parseAmountToCents(l.amount);
    return c === null ? 0 : sign * Math.abs(c);
  });
  const remainder = totalCents - cents.reduce((a, b) => a + b, 0);
  const valid =
    lines.length >= 2 && cents.every((c) => c !== 0) && remainder === 0;
  const set = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard escape handler for the split form container, not itself interactive
    <div
      className="rounded-card bg-card p-5 shadow-float"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        e.stopPropagation();
      }}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-headline font-semibold">Split</h3>
        <span className="text-caption text-ink-2">
          Total <AmountText cents={totalCents} colorize={false} />
        </span>
      </div>
      <div className="grid gap-2">
        {lines.map((l, i) => (
          <div
            key={l.key}
            className="grid grid-cols-[1fr_140px_32px] items-center gap-2"
          >
            <select
              className="h-9 rounded-control border border-line bg-card px-2 text-body"
              value={l.categoryId}
              onChange={(e) => set(i, { categoryId: Number(e.target.value) })}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentName ? `${c.parentName} › ` : ""}
                  {c.name}
                </option>
              ))}
            </select>
            <Input
              className="tnum h-9 rounded-control text-right"
              placeholder="0.00"
              value={l.amount}
              onChange={(e) => set(i, { amount: e.target.value })}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              disabled={lines.length <= 2}
              aria-label="Remove line"
            >
              ×
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setLines((ls) => [
              ...ls,
              { key: nextKey.current++, categoryId: first, amount: "" },
            ])
          }
          disabled={lines.length >= 12}
        >
          Add line
        </Button>
        <span
          className={`tnum text-caption ${remainder === 0 ? "text-positive" : "text-warning"}`}
        >
          Remaining <AmountText cents={remainder} colorize={false} />
        </span>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(
                lines.map((l, i) => ({
                  categoryId: l.categoryId,
                  amountCents: cents[i],
                })),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Save split
        </Button>
      </div>
    </div>
  );
}
