import type { Db } from "@/lib/db/client";
import { getSetting, setSetting } from "@/lib/settings";

export const FLOOR_KEY = "forecast_floor_cents";

export function getFloor(db: Db): number {
  return getSetting<number>(db, FLOOR_KEY, 0);
}

export function setFloor(db: Db, cents: number): void {
  setSetting(db, FLOOR_KEY, cents);
}
