import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { merchantAliases, transactions } from "@/lib/db/schema";
import { loadCities } from "./cities";
import { cleanMerchant } from "./merchant";

export type AliasRow = {
  id: number;
  pattern: string;
  matchType: "contains" | "regex";
  merchant: string;
  builtin: boolean;
};
type AliasInput = {
  pattern: string;
  matchType?: "contains" | "regex";
  merchant: string;
};

export function validateAlias(input: {
  pattern: string;
  matchType?: "contains" | "regex";
}): string | null {
  const p = input.pattern.trim();
  if (p.length < 2) return "Pattern must be at least 2 characters.";
  if ((input.matchType ?? "contains") === "regex") {
    try {
      new RegExp(p, "i");
    } catch {
      return "That regular expression is not valid.";
    }
  }
  return null;
}

export const BUILTIN_ALIASES: AliasInput[] = [
  // Order is priority: loadAliases returns builtins by id, and ids follow this
  // array, so a narrower pattern has to come before the broader one it sits
  // inside ("prime video" before "amazon").
  { pattern: "prime video", merchant: "Prime Video" },
  { pattern: "amazon", merchant: "Amazon" },
  { pattern: "amzn", merchant: "Amazon" },
  { pattern: "apple.com/bill", merchant: "Apple" },
  { pattern: "hobby-lobby", merchant: "Hobby Lobby" },
  { pattern: "hobbylobby", merchant: "Hobby Lobby" },
  { pattern: "sprouts", merchant: "Sprouts" },
  { pattern: "h-e-b", merchant: "H-E-B" },
  { pattern: "heb", merchant: "H-E-B" },
  { pattern: "kroger fuel", merchant: "Kroger Fuel" },
  { pattern: "kroger", merchant: "Kroger" },
  { pattern: "wal-mart", merchant: "Walmart" },
  { pattern: "walmart", merchant: "Walmart" },
  { pattern: "target", merchant: "Target" },
  { pattern: "starbucks", merchant: "Starbucks" },
  { pattern: "dutchbros", merchant: "Dutch Bros" },
  { pattern: "doordash", merchant: "DoorDash" },
  { pattern: "uber eats", merchant: "Uber Eats" },
  { pattern: "uber", merchant: "Uber" },
  { pattern: "lyft", merchant: "Lyft" },
  { pattern: "netflix", merchant: "Netflix" },
  { pattern: "spotify", merchant: "Spotify" },
  { pattern: "siriusxm", merchant: "SiriusXM" },
  { pattern: "shell oil", merchant: "Shell" },
  { pattern: "qt", merchant: "QuikTrip" },
  { pattern: "chick-fil-a", merchant: "Chick-fil-A" },
  { pattern: "applecard gsbank", merchant: "Apple Card Payment" },
  { pattern: "chase card ending", merchant: "Chase Card Payment" },
  { pattern: "acorns", merchant: "Acorns" },
  { pattern: "affirm", merchant: "Affirm" },
  { pattern: "gofundme", merchant: "GoFundMe" },
  { pattern: "7-eleven", merchant: "7-Eleven" },
  { pattern: "7eleven", merchant: "7-Eleven" },
  { pattern: "7-11", merchant: "7-Eleven" },
  { pattern: "att*bill", merchant: "AT&T" },
  { pattern: "att bill", merchant: "AT&T" },
  { pattern: "workspace", merchant: "Google Workspace" },
];

export function ensureBuiltinAliases(db: Db): void {
  const have = new Set(
    db
      .select({ pattern: merchantAliases.pattern })
      .from(merchantAliases)
      .where(eq(merchantAliases.builtin, true))
      .all()
      .map((r) => r.pattern),
  );
  for (const a of BUILTIN_ALIASES) {
    if (have.has(a.pattern)) continue;
    db.insert(merchantAliases)
      .values({
        pattern: a.pattern,
        matchType: a.matchType ?? "contains",
        merchant: a.merchant,
        builtin: true,
      })
      .run();
  }
}

export function loadAliases(db: Db): AliasRow[] {
  const rows = db
    .select()
    .from(merchantAliases)
    .orderBy(asc(merchantAliases.id))
    .all() as AliasRow[];
  return [...rows.filter((r) => !r.builtin), ...rows.filter((r) => r.builtin)];
}

function matches(alias: AliasRow, text: string): boolean {
  if (alias.matchType === "regex") {
    try {
      return new RegExp(alias.pattern, "i").test(text);
    } catch {
      return false;
    }
  }
  const escaped = alias.pattern
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text);
}

export function resolveMerchant(
  raw: string,
  aliases: AliasRow[],
  cities?: ReadonlySet<string>,
): string {
  const cleaned = cleanMerchant(raw, { cities });
  for (const a of aliases)
    if (matches(a, raw) || matches(a, cleaned)) return a.merchant;
  return cleaned;
}

export function reapplyMerchants(db: Db): number {
  const aliases = loadAliases(db);
  const cities = loadCities(db);
  const rows = db
    .select({
      id: transactions.id,
      raw: transactions.rawDescription,
      merchant: transactions.merchant,
    })
    .from(transactions)
    .all();
  let changed = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      const next = resolveMerchant(r.raw, aliases, cities);
      if (next === r.merchant) continue;
      tx.update(transactions)
        .set({ merchant: next })
        .where(eq(transactions.id, r.id))
        .run();
      changed++;
    }
  });
  return changed;
}

export function createAlias(
  db: Db,
  input: AliasInput,
): { id: number; updated: number } {
  const error = validateAlias(input);
  if (error) throw new Error(error);
  const [row] = db
    .insert(merchantAliases)
    .values({
      pattern: input.pattern.trim(),
      matchType: input.matchType ?? "contains",
      merchant: input.merchant.trim(),
      builtin: false,
    })
    .returning({ id: merchantAliases.id })
    .all();
  return { id: row.id, updated: reapplyMerchants(db) };
}

export function deleteAlias(db: Db, id: number): number {
  db.delete(merchantAliases)
    .where(and(eq(merchantAliases.id, id), eq(merchantAliases.builtin, false)))
    .run();
  return reapplyMerchants(db);
}
