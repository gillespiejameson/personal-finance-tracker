export type WallSummary = {
  generatedAt: string; // ISO time
  today: string; // YYYY-MM-DD
  gateOpen: boolean; // the budget gate: false until 2 complete months of data
  safeToSpend: {
    perDayCents: number;
    totalCents: number;
    untilDate: string; // next payday or month end
    horizonLabel: "until payday" | "until month end";
  } | null;
  bills: {
    due: {
      name: string;
      cents: number;
      expectedDate: string;
      overdue: boolean;
      categoryColor: string | null;
    }[];
    dueTotalCents: number;
  };
  review: { count: number; streakWeeks: number; weeklyDue: boolean };
  budget: {
    month: string;
    spentCents: number;
    budgetedCents: number;
    elapsedShare: number;
  } | null;
  nextPlanned: { name: string; cents: number; date: string } | null;
  alerts: { count: number };
};
export const NOT_ENROLLED = "Not enrolled.";
export const DEVICE_COOKIE = "wall_device";
