import type { Db } from "@/lib/db/client";
import { getSetting, setSetting } from "@/lib/settings";

export const DISMISSED_KEY = "anomalies_dismissed";
export const DISMISS_CAP = 500;

export function listDismissed(db: Db): string[] {
  return getSetting<string[]>(db, DISMISSED_KEY, []);
}

export function dismiss(db: Db, key: string): void {
  const list = listDismissed(db).filter((k) => k !== key);
  list.push(key);
  setSetting(db, DISMISSED_KEY, list.slice(-DISMISS_CAP));
}

export function undismiss(db: Db, key: string): void {
  setSetting(
    db,
    DISMISSED_KEY,
    listDismissed(db).filter((k) => k !== key),
  );
}
