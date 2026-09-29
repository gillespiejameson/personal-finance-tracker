import { AmountText } from "@/components/finance/AmountText";
import { CategoryChip } from "@/components/finance/CategoryChip";
import { Card } from "@/components/ui/card";
import { PARENT_COLORS } from "@/lib/categories/palette";
import { formatCents } from "@/lib/money";
import type { IrregularItem } from "@/lib/spreading/types";

function Row({ item }: { item: IrregularItem }) {
  const color = item.color ?? PARENT_COLORS.savings;
  const pct =
    item.amountCents > 0
      ? Math.min(1, Math.max(0, item.accruedCents / item.amountCents))
      : 0;
  return (
    <div className="grid grid-cols-[1fr_110px_110px_1fr] items-center gap-4 border-t border-line py-2 first:border-t-0">
      <div className="min-w-0">
        <div className="truncate text-body font-medium">{item.name}</div>
        {item.categoryName && (
          <CategoryChip
            name={item.categoryName}
            color={color}
            className="mt-1"
          />
        )}
      </div>
      <AmountText
        cents={item.monthlyCents}
        sign="never"
        colorize={false}
        className="text-right"
      />
      <div className="tnum text-right text-caption text-ink-2">
        {item.nextDue ?? "passed"}
      </div>
      <div>
        <div className="h-1.5 w-full overflow-hidden rounded-pill bg-subtle">
          <div
            className="h-full rounded-pill"
            style={{ width: `${pct * 100}%`, backgroundColor: color }}
          />
        </div>
        <div className="tnum mt-1 text-micro text-ink-3">
          {formatCents(item.accruedCents, { sign: "never" })} of{" "}
          {formatCents(item.amountCents, { sign: "never" })} set aside
        </div>
      </div>
    </div>
  );
}

export function SetAsideCard({ items }: { items: IrregularItem[] }) {
  if (items.length === 0) return null;
  const totalMonthly = items.reduce((s, i) => s + i.monthlyCents, 0);
  return (
    <Card>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-headline font-semibold">Set aside</h2>
        <span className="tnum text-caption text-ink-2">
          {formatCents(totalMonthly, { sign: "never" })}/mo
        </span>
      </div>
      <div className="grid">
        {items.map((item) => (
          <Row key={item.key} item={item} />
        ))}
      </div>
    </Card>
  );
}
