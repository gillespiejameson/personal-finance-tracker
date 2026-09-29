import type { SyncResult } from "./types";

/** One line for a toast: "Added 12 · updated 3 · pending 2". */
export function summarize(results: SyncResult[]): string {
  const t = results.reduce(
    (a, r) => ({
      added: a.added + r.added,
      updated: a.updated + r.updated,
      pending: a.pending + r.pending,
    }),
    { added: 0, updated: 0, pending: 0 },
  );
  return `Added ${t.added} · updated ${t.updated} · pending ${t.pending}`;
}

/** Whether a sync actually moved anything (used to stay quiet on auto syncs). */
export function changedAnything(results: SyncResult[]): boolean {
  return results.some((r) => r.added + r.updated + r.removed > 0);
}
