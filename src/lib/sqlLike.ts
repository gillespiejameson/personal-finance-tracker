/** Escape LIKE wildcards so user text matches literally. Use with `ESCAPE '\'`. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Parse a positive integer from a query-string value; undefined when absent or invalid. */
export function parseIdParam(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
