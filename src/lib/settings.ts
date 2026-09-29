import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { settings } from "./db/schema";

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row === undefined ? fallback : (row.value as T);
}

export function setSetting(db: Db, key: string, value: unknown): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

/** Removes a key so `getSetting` falls back again; `settings.value` is NOT NULL, so a stored `null` is not an option. */
export function deleteSetting(db: Db, key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}
