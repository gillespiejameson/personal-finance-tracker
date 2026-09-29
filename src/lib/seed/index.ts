import { ensureDefaultCategories } from "@/lib/categories/ensure";
import { addDays, monthOf, todayIso } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";
import { dedupeHash } from "@/lib/import/dedupe";
import type { ParsedRow } from "@/lib/import/types";
import { cleanMerchant } from "@/lib/normalize/merchant";
import { applyTransfers } from "@/lib/transfers/apply";

function addAccount(db: Db, values: typeof accounts.$inferInsert): number {
  const [row] = db
    .insert(accounts)
    .values(values)
    .returning({ id: accounts.id })
    .all();
  if (!row) throw new Error(`Could not create the ${values.name} account`);
  return row.id;
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pending = {
  accountKey: "chk" | "sav" | "card" | "amex";
  date: string;
  amountCents: number;
  raw: string;
};

const BILLS: [string, number, number][] = [
  ["NETFLIX.COM", 1549, 3],
  ["SPOTIFY USA", 1199, 5],
  ["VERIZON WIRELESS PMT", 8500, 8],
  ["COMCAST XFINITY", 7000, 10],
  ["PLANET FITNESS", 2499, 12],
  ["APPLE.COM/BILL ICLOUD", 299, 14],
  ["GEICO AUTO INS", 11800, 16],
  ["DUKE ENERGY", 0, 18],
  ["CITY WATER UTIL", 0, 19],
  ["TOYOTA FINANCIAL", 38500, 20],
  ["GOOGLE *YOUTUBE PREMIUM", 1399, 22],
  ["NYTIMES DIGITAL", 1700, 24],
];
const VARIABLE: [string, number, number, Pending["accountKey"]][] = [
  ["KROGER #1234 CINCINNATI OH", 4500, 14000, "card"],
  ["TRADER JOE'S #512", 3000, 9000, "card"],
  ["COSTCO WHSE #1021", 8000, 22000, "card"],
  ["SQ *BLUE BOTTLE COFFEE", 450, 900, "amex"],
  ["STARBUCKS STORE 12345", 500, 1200, "amex"],
  ["DOORDASH*CHIPOTLE", 1500, 3500, "amex"],
  ["TST* SHAKE SHACK", 1800, 4000, "amex"],
  ["SHELL OIL 57442133", 3500, 6500, "card"],
  ["AMAZON MKTPL*2K4L9 AMZN.COM/BILL WA", 1200, 9000, "card"],
  ["TARGET 00012345", 2500, 9500, "card"],
  ["CVS/PHARMACY #08765", 800, 4000, "card"],
  ["UBER *TRIP", 900, 3200, "amex"],
  ["AMC THEATRES 1234", 1500, 4000, "amex"],
  ["LYFT *RIDE", 800, 2500, "amex"],
];

export function seed(
  db: Db,
  opts: { months?: number; seedValue?: number; endDate?: string } = {},
) {
  const months = opts.months ?? 3;
  const rnd = mulberry32(opts.seedValue ?? 42);
  const end = opts.endDate ?? todayIso();
  const start = addDays(`${monthOf(addDays(end, -30 * (months - 1)))}-01`, 0);
  ensureDefaultCategories(db);

  const ids = {
    chk: addAccount(db, {
      name: "Chase Checking",
      type: "checking",
      institution: "Chase",
      color: "#0A84FF",
    }),
    sav: addAccount(db, {
      name: "Ally Savings",
      type: "savings",
      institution: "Ally",
      color: "#00C7BE",
    }),
    card: addAccount(db, {
      name: "Sapphire",
      type: "credit",
      institution: "Chase",
      color: "#5856D6",
    }),
    amex: addAccount(db, {
      name: "Amex Gold",
      type: "credit",
      institution: "American Express",
      color: "#FF9500",
    }),
  };

  const rows: Pending[] = [];
  const between = (lo: number, hi: number) =>
    Math.round(lo + rnd() * (hi - lo));
  let cardBalance = 0;

  const costcoDay = addDays(start, 12);
  const amazonDay = addDays(start, 20);
  const refundDay = addDays(amazonDay, 5);
  const noiseDay = addDays(start, 40);

  for (let d = start; d <= end; d = addDays(d, 1)) {
    const day = Number(d.slice(8, 10));
    const daysFromStart = Math.round(
      (Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, day) -
        Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, 1)) /
        86_400_000,
    );
    if (daysFromStart % 14 === 4)
      rows.push({
        accountKey: "chk",
        date: d,
        amountCents: 240000,
        raw: "ACME CORP DES:PAYROLL ID:1234",
      });
    if (day === 1)
      rows.push({
        accountKey: "chk",
        date: d,
        amountCents: -165000,
        raw: "ACH DEBIT GREENWOOD PROPERTIES RENT",
      });
    for (const [name, cents, billDay] of BILLS) {
      if (day !== billDay) continue;
      const amt =
        cents ||
        (name.startsWith("DUKE") ? between(9000, 14000) : between(4000, 6000));
      const key: Pending["accountKey"] =
        name.includes("TOYOTA") ||
        name.includes("GEICO") ||
        name.includes("ENERGY") ||
        name.includes("WATER")
          ? "chk"
          : "card";
      rows.push({ accountKey: key, date: d, amountCents: -amt, raw: name });
      if (key === "card") cardBalance += amt;
    }
    if (d === costcoDay) {
      rows.push({
        accountKey: "card",
        date: d,
        amountCents: -21000,
        raw: "COSTCO WHSE #1021 SPLIT ME",
      });
      cardBalance += 21000;
    }
    if (d === amazonDay) {
      rows.push({
        accountKey: "card",
        date: d,
        amountCents: -2345,
        raw: "AMAZON MKTPL*7Q1ZZ AMZN.COM/BILL WA",
      });
      cardBalance += 2345;
    }
    if (d === refundDay) {
      rows.push({
        accountKey: "card",
        date: d,
        amountCents: 2345,
        raw: "AMAZON MKTPL*7Q1ZZ REFUND",
      });
      cardBalance -= 2345;
    }
    if (d === noiseDay)
      rows.push({
        accountKey: "chk",
        date: d,
        amountCents: -1275,
        raw: "CHECKCARD 0314 SQ *SOME POPUP",
      });
    if (day === 6) {
      rows.push({
        accountKey: "chk",
        date: d,
        amountCents: -40000,
        raw: "ONLINE TRANSFER TO ALLY SAVINGS",
      });
      rows.push({
        accountKey: "sav",
        date: d,
        amountCents: 40000,
        raw: "TRANSFER FROM CHASE CHECKING",
      });
    }
    if (day === 25 && cardBalance > 0) {
      rows.push({
        accountKey: "chk",
        date: d,
        amountCents: -cardBalance,
        raw: "CHASE CREDIT CRD AUTOPAY",
      });
      rows.push({
        accountKey: "card",
        date: addDays(d, 2),
        amountCents: cardBalance,
        raw: "Payment Thank You-Mobile",
      });
      cardBalance = 0;
    }
    const n = 1 + (rnd() < 0.5 ? 1 : 0) + (rnd() < 0.3 ? 1 : 0); // avg ~1.8 purchases/day
    for (let i = 0; i < n; i++) {
      const [raw, lo, hi, key] = VARIABLE[Math.floor(rnd() * VARIABLE.length)];
      const amt = between(lo, hi);
      rows.push({ accountKey: key, date: d, amountCents: -amt, raw });
      if (key === "card") cardBalance += amt;
    }
  }
  const seen = new Set<string>();
  const values = rows.flatMap((r) => {
    const parsed: ParsedRow = {
      date: r.date,
      amountCents: r.amountCents,
      rawDescription: r.raw,
      merchant: cleanMerchant(r.raw),
    };
    const accountId = ids[r.accountKey];
    let salt = 0;
    let hash = dedupeHash(accountId, parsed);
    while (seen.has(hash))
      hash = dedupeHash(accountId, {
        ...parsed,
        rawDescription: `${parsed.rawDescription}\u0000${++salt}`,
      });
    seen.add(hash);
    return [
      {
        accountId,
        date: r.date,
        amountCents: r.amountCents,
        rawDescription: r.raw,
        merchant: parsed.merchant,
        dedupeHash: hash,
      },
    ];
  });
  for (let i = 0; i < values.length; i += 200)
    db.insert(transactions)
      .values(values.slice(i, i + 200))
      .run();
  applyTransfers(db);
  return { accounts: 4, transactions: values.length };
}
