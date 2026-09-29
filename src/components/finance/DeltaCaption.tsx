import { formatCents } from "@/lib/money";

export function DeltaCaption({
  now,
  before,
  higherIsBetter,
  partial = false,
}: {
  now: number;
  before: number;
  higherIsBetter: boolean;
  /** The comparison is against the same stretch of the previous month. */
  partial?: boolean;
}) {
  const d = now - before;
  if (before === 0) {
    return (
      <span className="block text-caption text-ink-3">
        {partial ? "nothing at this point last month" : "no prior month"}
      </span>
    );
  }
  const color =
    d === 0
      ? "text-ink-2"
      : d > 0 === higherIsBetter
        ? "text-positive"
        : "text-negative";
  return (
    <span className={`tnum block text-caption ${color}`}>
      {d >= 0 ? "+" : "−"}
      {formatCents(Math.abs(d), { sign: "never" })}{" "}
      {partial ? "vs same point last month" : "vs last month"}
    </span>
  );
}
