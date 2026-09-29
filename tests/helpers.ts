/**
 * `Array.prototype.find` that fails loudly instead of handing back
 * `undefined`, so a test that stops matching what it means to assert on
 * reports a clear message rather than a `TypeError` on a later property read.
 */
export function mustFind<T>(
  xs: readonly T[],
  predicate: (x: T) => boolean,
  what = "a matching item",
): T {
  const found = xs.find(predicate);
  if (found === undefined) throw new Error(`Expected to find ${what}`);
  return found;
}
