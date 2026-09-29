export type Goal = {
  id: number;
  name: string;
  targetCents: number;
  targetDate: string | null;
  categoryId: number;
  startingCents: number;
  startDate: string;
  archived: boolean;
  progressCents: number;
  pct: number; // 0..1 capped
  monthsRemaining: number | null;
  monthlyNeededCents: number | null;
  reached: boolean;
};
