import type { Db } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";

const STATE =
  "(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)";

/**
 * The word immediately before a trailing (uppercase) state code, plus the
 * optional posting date some banks append. The state is matched
 * case-sensitively so ordinary words like "or" or "in" cannot pass for one.
 */
const TRAILING_CITY = new RegExp(
  `(?:^|\\s)([A-Za-z][A-Za-z'.-]*)\\s+${STATE}(?:\\s+\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)?\\s*$`,
);

/** A word has to show up this often before it counts as a city. */
const MIN_OCCURRENCES = 3;

/**
 * Learn the user's local city names from their own statements: the token in
 * front of a trailing state code, kept once it has been seen at least three
 * times. One appearance is far more likely to be the tail of a merchant's name
 * than a place.
 *
 * `extraRaw` lets a caller fold in descriptions that are not in the database
 * yet — an import counts the file it is about to commit, so a first import is
 * cleaned with the same city set that later ones will use.
 */
export function loadCities(db: Db, extraRaw: string[] = []): Set<string> {
  const counts = new Map<string, number>();
  const tally = (raw: string) => {
    const m = TRAILING_CITY.exec(raw.replace(/\s+/g, " ").trim());
    if (!m) return;
    const word = m[1].toLowerCase();
    counts.set(word, (counts.get(word) ?? 0) + 1);
  };
  for (const r of db
    .select({ raw: transactions.rawDescription })
    .from(transactions)
    .all())
    tally(r.raw);
  for (const raw of extraRaw) tally(raw);
  const out = new Set<string>();
  for (const [word, n] of counts) if (n >= MIN_OCCURRENCES) out.add(word);
  return out;
}
