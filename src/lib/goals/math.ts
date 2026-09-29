export function monthsRemaining(today: string, targetDate: string): number {
  const [ty, tm] = today.slice(0, 7).split("-").map(Number);
  const [gy, gm] = targetDate.slice(0, 7).split("-").map(Number);
  return Math.max(1, (gy - ty) * 12 + (gm - tm) + 1);
}

export function goalMath(i: {
  targetCents: number;
  startingCents: number;
  contributionsCents: number;
  targetDate: string | null;
  today: string;
}) {
  const progressCents = i.startingCents + i.contributionsCents;
  const gap = Math.max(0, i.targetCents - progressCents);
  const reached = gap === 0;
  const months =
    i.targetDate === null ? null : monthsRemaining(i.today, i.targetDate);
  return {
    progressCents,
    pct:
      i.targetCents > 0
        ? Math.min(1, Math.max(0, progressCents / i.targetCents))
        : 0,
    monthsRemaining: months,
    monthlyNeededCents:
      months === null || reached ? null : Math.ceil(gap / months),
    reached,
  };
}
