import type { ParsedRow } from "@/lib/import/types";
import type { Snapshot } from "./types";

type Bal = ParsedRow & { balanceCents: number };
const hasBalance = (r: ParsedRow): r is Bal =>
  typeof r.balanceCents === "number";

/** True when the file lists newer rows first (Chase); undefined when it cannot be told. */
function newestFirst(rows: Bal[]): boolean | undefined {
  const first = rows[0]?.date;
  const last = rows[rows.length - 1]?.date;
  if (first === undefined || last === undefined || first === last)
    return undefined;
  return first > last;
}

/** For a same-day group whose order is unknown, pick the row that no other row continues from. */
function endOfDayByArithmetic(group: Bal[]): Bal {
  const continued = new Set<number>();
  for (const a of group)
    for (const b of group)
      if (a !== b && a.balanceCents + b.amountCents === b.balanceCents)
        continued.add(group.indexOf(a));
  const ends = group.filter((_, i) => !continued.has(i));
  return ends.length === 1 ? ends[0] : group[group.length - 1];
}

export function snapshotsFromRows(rows: ParsedRow[]): Snapshot[] {
  const withBal = rows.filter(hasBalance);
  const order = newestFirst(withBal);
  const byDate = new Map<string, Bal[]>();
  for (const r of withBal)
    byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => {
      const pick =
        group.length === 1
          ? group[0]
          : order === true
            ? group[0]
            : order === false
              ? group[group.length - 1]
              : endOfDayByArithmetic(group);
      return { date, balanceCents: pick.balanceCents };
    });
}
