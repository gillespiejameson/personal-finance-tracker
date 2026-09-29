import type { Line } from "@/lib/insights/lines";
import type { Bill } from "@/lib/recurring/refresh";

/**
 * Ledger lines and bills a caller already has in hand. Loaders that would
 * otherwise read them again take this so one request loads each at most once;
 * anything missing is loaded as before, so passing nothing keeps the old
 * behaviour.
 */
export type Pre = { lines?: Line[]; bills?: Bill[] };
