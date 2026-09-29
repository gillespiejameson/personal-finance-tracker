export type ForecastEvent = {
  date: string;
  name: string;
  amountCents: number;
  kind: "income" | "bill" | "planned";
};
export type ForecastPoint = {
  date: string;
  balanceCents: number;
  events: ForecastEvent[];
};
export type SpendRate = {
  source: "budget" | "average" | "none";
  thisMonthDailyCents: number;
  /** Variable spend budgeted/averaged for a later (non-current) month; the
   * per-day rate applied to any given later month is this divided by that
   * month's own day count (see `forecastSeries`). */
  laterMonthlyCents: number;
};
export type ForecastPage = {
  today: string;
  days: 30 | 60 | 90;
  floorCents: number;
  hasCash: boolean;
  startCents: number;
  rate: SpendRate;
  points: ForecastPoint[];
  events: (ForecastEvent & { afterCents: number })[];
  lowestCents: number;
  lowestDate: string;
  endCents: number;
  endDate: string;
  belowFloorOn: string | null;
  shortByCents: number;
  /** floorCents − balance on the day of the first breach (`belowFloorOn`);
   * 0 when there is no breach. May differ from `shortByCents`, which is
   * measured at the lowest point of the whole series. */
  shortAtBreachCents: number;
};
