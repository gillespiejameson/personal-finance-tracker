const STATE =
  "(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)";
const MULTI_CITY =
  "(?:Fort|San|Santa|New|Las|Los|St\\.?|Saint|The|El|Port|Mountain|Mount|Grand|North|South|East|West|Lake)";

/**
 * Single-word US cities common enough that seeing one before a state code is
 * far more likely to be a location than part of a merchant's name. Anything
 * outside this list needs another signal before the city rule will strip it
 * (see `stripCityState`), so a two-word merchant like "Verda Beauty CA" keeps
 * both of its words.
 */
export const MAJOR_CITIES: ReadonlySet<string> = new Set([
  "albuquerque",
  "anaheim",
  "arlington",
  "atlanta",
  "aurora",
  "austin",
  "bakersfield",
  "baltimore",
  "boston",
  "brooklyn",
  "charlotte",
  "chicago",
  "cincinnati",
  "cleveland",
  "columbus",
  "dallas",
  "denver",
  "detroit",
  "fresno",
  "honolulu",
  "houston",
  "indianapolis",
  "irvine",
  "jacksonville",
  "louisville",
  "memphis",
  "mesa",
  "miami",
  "milwaukee",
  "minneapolis",
  "nashville",
  "oakland",
  "omaha",
  "orlando",
  "philadelphia",
  "phoenix",
  "pittsburgh",
  "portland",
  "raleigh",
  "sacramento",
  "seattle",
  "tampa",
  "tucson",
  "tulsa",
]);

export type CleanOptions = {
  /**
   * Extra city names, lowercased — normally learned from the user's own
   * statements (see `loadCities`), which is how a local city like "springfield"
   * comes to be recognised.
   */
  cities?: ReadonlySet<string>;
};

/** Descriptions that mean one specific thing regardless of the rest of the text. */
const SPECIAL: [RegExp, string][] = [
  [/from:\s*venmo\b/i, "Venmo"],
  [/bnf-paypal|from:\s*paypal\b/i, "PayPal"],
  [/\batm\s+check\s+deposit\b/i, "ATM Check Deposit"],
  [/^monthly\s+service\s+fee$/i, "Monthly Service Fee"],
];

const P2P =
  /^(?:zelle|venmo|paypal)\s+(?:payment|transfer)?\s*(?:to|from)\s+(.+)$/i;

const EMPTY_CITIES: ReadonlySet<string> = new Set<string>();
/** "06/08 SKYWARD AI ..." — a posting date left over after the prefixes go. */
const LEADING_DATE = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+/;
/** "SKYWARD AI United States AZ" — the country sits between name and state. */
const COUNTRY_TAIL = new RegExp(
  `\\s+United\\s+States(?=(?:\\s+${STATE})?$)`,
  "i",
);

/** Raw payee text of a person-to-person payment, or null. */
export function payeeFromP2P(raw: string): string | null {
  const m = P2P.exec(raw.replace(/\s+/g, " ").trim());
  return m ? m[1].trim() : null;
}

const TAILS: RegExp[] = [
  /\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*$/, // trailing MM/DD
  /\s+(?:web|ppd|ccd|arc|pos)\s+id:?.*$/i,
  /\s+transaction\s*#?:?.*$/i,
  /\s+ref:.*$/i,
  /\s+info:.*$/i,
  /\s+trn:.*$/i,
  // Credit-union SimpleFIN feed: "… CA 4242 - FIRST M LAST" — the card's last
  // four and the cardholder's name, absent from the bank's own CSV export.
  // Last in the list so an earlier tail (a trailing posting date, "REF: …")
  // is gone first and this one still sees the suffix at the end of the string.
  /\s\d{4}\s-\s[A-Z][A-Z.'-]*(?:\s[A-Z][A-Z.'-]*)*\s*$/,
];

// Order matters: "Refund SP BANJO BARN" needs the refund prefix gone before the "SP " one.
const PREFIXES: RegExp[] = [
  /^refund\s+/i,
  /^(?:sq|tst|py|sp|spaff|sxm|pp|dd|trn|paypal|google)\s*\*\s*/i, // SQ *, TST*, SPAFF *, GOOGLE *
  /^(?:sq|sp|py)\s+(?=\S)/i, // "SP GREEN LEAF"
  /^paypal\s+(?:purchase|inst\s+xfer)\s+/i,
  /^(?:pos|debit|credit|checkcard|check\s+card|purchase|recurring)\s+(?:debit|credit|purchase|payment)?\s*/i,
];

const NOISE: [RegExp, string][] = [
  [/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g, " "], // phone 866-712-7753
  [/\b\d{3}-\d{5,}\b/g, " "], // phone 555-0101234, 185-87654321
  [/\bwww\.\S+/gi, " "], // www.brranch.c
  [/#\s?\d+\b/g, " "], // #016 (no leading \b: "#" is non-word, so a boundary never holds right before it when it follows whitespace)
  [/\bt-\d+\b/gi, " "], // T-2045
  [/([a-z]{3,})\d{4,}\b/gi, "$1"], // store number glued to a name: SUBWAY00051234 -> SUBWAY
  [/\b\d{3,}\b/g, " "], // bare store / reference numbers
  [/\.{2,}/g, " "], // "..."
];

/**
 * Strips reference-code tokens (JPM12abcdefg, 381QX57, X9KQZ41, 2K4L9) without touching the
 * merchant's own name, even when that name is itself alphanumeric (7ELEVEN, K9PAWS).
 * A word only counts as a code when it isn't the first word and mixes enough digits and
 * letters to look machine-generated.
 */
function stripCodes(s: string): string {
  const words = s.split(" ");
  return words
    .filter((w, i) => {
      if (i === 0) return true;
      const digits = (w.match(/\d/g) ?? []).length;
      const letters = (w.match(/[a-z]/gi) ?? []).length;
      return !(
        w.length >= 5 &&
        digits >= 2 &&
        letters >= 2 &&
        /^[a-z0-9]+$/i.test(w)
      );
    })
    .join(" ");
}

function domainToName(s: string): string {
  // "APPLE.COM/BILL" -> "APPLE", "Amzn.com/bill" -> "Amzn", "RAILWAY.COM" -> "RAILWAY"
  // "HELP.UBER.COM" -> "UBER" (subdomains are dropped, keeping only the second-level label)
  return s.replace(
    /\b(?:[a-z0-9-]+\.)*([a-z0-9-]+)\.(?:com|net|co|org|io)(?:\/[a-z0-9/_-]*)?/gi,
    "$1",
  );
}

// "... Lake City IL" (multi-word city) — needs at least one other word before it
const STRIP_CITY_MULTI = new RegExp(
  `^(.+?\\S)\\s+${MULTI_CITY}\\s+[A-Za-z'.-]+\\s+${STATE}$`,
  "i",
);
// "... Springfield IL" (single-word city) — needs at least one other word before it
const STRIP_CITY_SINGLE = new RegExp(
  `^(.+?\\S)\\s+([A-Za-z'.-]+)\\s+${STATE}$`,
);
// "... TX" alone at the end
const STRIP_CITY_STATE = new RegExp(`^(.+?\\S)\\s+${STATE}$`);

function casing(word: string): "upper" | "lower" | "mixed" {
  const letters = word.replace(/[^A-Za-z]/g, "");
  if (letters === "") return "mixed";
  if (letters === letters.toUpperCase()) return "upper";
  if (letters === letters.toLowerCase()) return "lower";
  return "mixed";
}

/**
 * Whether the word sitting between the merchant and a trailing state code is
 * safe to drop as a city.
 *
 * The old rule dropped it unconditionally, which ate the second half of every
 * two-word merchant ("SP VERDA BEAUTY ... CA" became "Verda"). It now needs a
 * reason: enough words in front that the merchant survives without it, a
 * casing break that marks the city as a separate field ("BRIGHTWORKS Chicago"),
 * or recognition as an actual city.
 */
function looksLikeCity(
  before: string,
  word: string,
  cities: ReadonlySet<string>,
): boolean {
  const words = before.split(" ").filter(Boolean);
  if (words.length >= 3) return true;
  const prev = words[words.length - 1];
  if (prev !== undefined && casing(prev) !== casing(word)) return true;
  const lower = word.toLowerCase();
  return cities.has(lower) || MAJOR_CITIES.has(lower);
}

function stripCityState(s: string, cities: ReadonlySet<string>): string {
  let prev = "";
  let cur = s;
  while (cur !== prev) {
    prev = cur;
    // Apply only the first pattern that matches per pass: chaining all three
    // unconditionally over-strips a duplicated "city state" tail (e.g. a repeated
    // "SPRINGFIELD IL SPRINGFIELD IL" from some bank exports), consuming a real word.
    if (STRIP_CITY_MULTI.test(cur)) {
      cur = cur.replace(STRIP_CITY_MULTI, "$1");
      continue;
    }
    const single = STRIP_CITY_SINGLE.exec(cur);
    if (single && looksLikeCity(single[1], single[2], cities)) {
      cur = single[1];
      continue;
    }
    if (STRIP_CITY_STATE.test(cur)) cur = cur.replace(STRIP_CITY_STATE, "$1");
  }
  return cur;
}

function dedupeWords(s: string): string {
  const seen = new Set<string>();
  return s
    .split(" ")
    .filter((w) => {
      const k = w.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(" ");
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) =>
      w
        .split("-")
        .map((seg) =>
          seg.length <= 2
            ? seg.toUpperCase()
            : seg[0].toUpperCase() + seg.slice(1),
        )
        .join("-"),
    )
    .join(" ");
}

export function cleanMerchant(raw: string, opts: CleanOptions = {}): string {
  const cities = opts.cities ?? EMPTY_CITIES;
  let s = raw.replace(/\s+/g, " ").trim();
  if (s === "") return "Unknown";

  for (const [re, name] of SPECIAL) if (re.test(s)) return name;

  const payee = payeeFromP2P(s);
  if (payee !== null) s = payee;

  for (const re of TAILS) s = s.replace(re, "");
  s = s.trim();
  for (const re of PREFIXES) s = s.replace(re, ""); // before "*" is turned into a space
  // A posting date can lead as well as trail: "POS DEBIT 06/08 SKYWARD AI ...".
  s = s.replace(LEADING_DATE, "");
  s = s.replace(/\*/g, " ").replace(/\s+/g, " ").trim();

  // payroll: "C123456 ACMEPAY -PAYROLL" -> "ACMEPAY PAYROLL"
  const payroll = /^(.*?)\s*-?\s*payroll\b.*$/i.exec(s);
  if (payroll)
    s = `${payroll[1].replace(/^[A-Z]\d{4,}\s+/i, "").trim()} Payroll`;

  s = domainToName(s);
  for (const [re, repl] of NOISE) s = s.replace(re, repl);
  s = s.replace(/\s+/g, " ").trim();
  s = stripCodes(s);
  s = s.replace(COUNTRY_TAIL, "");
  s = s.replace(/\s+/g, " ").trim();
  s = stripCityState(s, cities);
  s = dedupeWords(s);
  s = s
    .replace(/[\s,.:;-]+$/g, "")
    .replace(/^[\s,.:;-]+/g, "")
    .trim();
  if (s === "") return "Unknown";
  return titleCase(s);
}
