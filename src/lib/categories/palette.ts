export const PARENT_KEYS = [
  "income",
  "home",
  "transport",
  "food",
  "bills",
  "health",
  "shopping",
  "fun",
  "gifts",
  "debt",
  "savings",
  "transfer",
  "uncategorized",
] as const;
export type ParentKey = (typeof PARENT_KEYS)[number];

export const PARENT_COLORS: Record<ParentKey, string> = {
  income: "#34C759",
  home: "#007AFF",
  transport: "#5856D6",
  food: "#FF9500",
  bills: "#AF52DE",
  health: "#FF3B30",
  shopping: "#FF2D55",
  fun: "#FFCC00",
  gifts: "#30B0C7",
  debt: "#A2845E",
  savings: "#00C7BE",
  transfer: "#8E8E93",
  uncategorized: "#C7C7CC",
};

/** Account dot colors offered in the account form. */
export const ACCOUNT_COLORS = [
  "#0A84FF",
  "#34C759",
  "#FF9500",
  "#AF52DE",
  "#FF2D55",
  "#5856D6",
  "#00C7BE",
  "#8E8E93",
] as const;

/** Colors offered for user-created category groups: Apple system colors not already used by `PARENT_COLORS`. */
export const GROUP_COLORS = [
  "#5AC8FA",
  "#32ADE6",
  "#BF5AF2",
  "#FF6482",
  "#FFD60A",
  "#30D158",
  "#AC8E68",
  "#FF9F0A",
] as const;

/**
 * The first `GROUP_COLORS` entry not already in `used`, or (if all are used)
 * the entry used least often, ties broken by palette order.
 */
export function nextGroupColor(used: readonly string[]): string {
  const usedLower = used.map((c) => c.toLowerCase());
  const unused = GROUP_COLORS.find((c) => !usedLower.includes(c.toLowerCase()));
  if (unused) return unused;
  let best: string = GROUP_COLORS[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of GROUP_COLORS) {
    const n = usedLower.filter((u) => u === c.toLowerCase()).length;
    if (n < bestCount) {
      bestCount = n;
      best = c;
    }
  }
  return best;
}

export function tint(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
