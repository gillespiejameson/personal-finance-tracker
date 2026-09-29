import { and, eq } from "drizzle-orm";
import {
  deletedSeedKeys,
  ensureDefaultCategories,
  findCategoryIdBySeedKey,
} from "@/lib/categories/ensure";
import type { Db } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";

type BuiltinRule = {
  pattern: string;
  /** Seed key of the target leaf category (see `src/lib/categories/defaults.ts`), not its display name — a renamed default leaf keeps its seed key. */
  category: string;
  field?: "merchant" | "raw";
  matchType?: "contains" | "regex";
  priority?: number;
  /** Sign the rule applies to; income rules are inflow-only. Defaults to `any`. */
  direction?: "in" | "out" | "any";
};

// Order = priority within the same tier. Contains-matches on the cleaned merchant unless `field: "raw"`.
export const BUILTIN_RULES: BuiltinRule[] = [
  // income
  {
    pattern: "payroll",
    category: "income/paycheck",
    field: "raw",
    direction: "in",
    priority: 10,
  },
  {
    pattern: "direct dep",
    category: "income/paycheck",
    field: "raw",
    direction: "in",
    priority: 10,
  },
  {
    pattern: "interest paid",
    category: "income/other-income",
    field: "raw",
    direction: "in",
    priority: 10,
  },
  // payments to accounts the user chose not to import
  {
    pattern: "apple card payment",
    category: "debt/card-payments",
    priority: 20,
  },
  {
    pattern: "chase card payment",
    category: "debt/card-payments",
    priority: 20,
  },
  {
    pattern: "chase card ending",
    category: "debt/card-payments",
    field: "raw",
    priority: 20,
  },
  {
    pattern: "credit crd",
    category: "debt/card-payments",
    field: "raw",
    priority: 20,
  },
  {
    pattern: "card payment",
    category: "debt/card-payments",
    field: "raw",
    priority: 21,
  },
  { pattern: "acorns", category: "savings/savings-investing", priority: 20 },
  { pattern: "robinhood", category: "savings/savings-investing", priority: 20 },
  { pattern: "affirm", category: "debt/loan-payments", priority: 20 },
  { pattern: "klarna", category: "debt/loan-payments", priority: 20 },
  {
    pattern: "monthly service fee",
    category: "debt/interest-fees",
    priority: 15,
  },
  {
    pattern: "overdraft",
    category: "debt/interest-fees",
    field: "raw",
    priority: 15,
  },
  {
    pattern: "interest charge",
    category: "debt/interest-fees",
    field: "raw",
    priority: 15,
  },
  // groceries
  { pattern: "h-e-b", category: "food/groceries", priority: 30 },
  { pattern: "kroger fuel", category: "transport/fuel", priority: 29 },
  { pattern: "kroger", category: "food/groceries", priority: 30 },
  { pattern: "sprouts", category: "food/groceries", priority: 30 },
  { pattern: "trader joe", category: "food/groceries", priority: 30 },
  { pattern: "whole foods", category: "food/groceries", priority: 30 },
  { pattern: "aldi", category: "food/groceries", priority: 30 },
  { pattern: "costco", category: "food/groceries", priority: 30 },
  {
    pattern: "instacart",
    category: "food/groceries",
    field: "raw",
    priority: 30,
  },
  // shopping
  { pattern: "amazon", category: "shopping/general", priority: 30 },
  {
    pattern: "\\btarget\\b",
    category: "shopping/general",
    matchType: "regex",
    priority: 30,
  },
  { pattern: "walmart", category: "shopping/general", priority: 30 },
  { pattern: "hobby lobby", category: "shopping/general", priority: 30 },
  // fuel / transport
  {
    pattern: "\\bshell\\b",
    category: "transport/fuel",
    matchType: "regex",
    priority: 30,
  },
  { pattern: "quiktrip", category: "transport/fuel", priority: 30 },
  {
    pattern: "7-eleven|racetrac|buc-ee",
    category: "transport/fuel",
    matchType: "regex",
    priority: 30,
  },
  { pattern: "exxon", category: "transport/fuel", priority: 30 },
  { pattern: "chevron", category: "transport/fuel", priority: 30 },
  {
    pattern: "\\buber\\b",
    category: "transport/repairs-parking-transit",
    matchType: "regex",
    priority: 31,
  },
  {
    pattern: "lyft",
    category: "transport/repairs-parking-transit",
    priority: 31,
  },
  { pattern: "airport parking", category: "fun/travel", priority: 30 },
  {
    pattern: "\\btolls?\\b",
    category: "transport/repairs-parking-transit",
    field: "raw",
    matchType: "regex",
    priority: 32,
  },
  // coffee & takeout
  { pattern: "starbucks", category: "food/coffee-takeout", priority: 30 },
  { pattern: "dutch bros", category: "food/coffee-takeout", priority: 30 },
  { pattern: "doordash", category: "food/coffee-takeout", priority: 30 },
  { pattern: "uber eats", category: "food/coffee-takeout", priority: 29 },
  // subscriptions & bills
  // Ahead of the "amazon" rule below, and matched on the raw description so it
  // wins whichever way the alias table happens to name the merchant.
  {
    pattern: "prime video",
    category: "bills/subscriptions",
    field: "raw",
    priority: 28,
  },
  {
    pattern: "google workspace",
    category: "bills/subscriptions",
    priority: 30,
  },
  { pattern: "anthropic", category: "bills/subscriptions", priority: 30 },
  { pattern: "openai", category: "bills/subscriptions", priority: 30 },
  { pattern: "dropbox", category: "bills/subscriptions", priority: 30 },
  { pattern: "github", category: "bills/subscriptions", priority: 30 },
  { pattern: "adobe", category: "bills/subscriptions", priority: 30 },
  { pattern: "netflix", category: "bills/subscriptions", priority: 30 },
  { pattern: "spotify", category: "bills/subscriptions", priority: 30 },
  {
    pattern: "\\bapple\\b",
    category: "bills/subscriptions",
    matchType: "regex",
    priority: 35,
  },
  { pattern: "siriusxm", category: "bills/subscriptions", priority: 30 },
  { pattern: "hulu", category: "bills/subscriptions", priority: 30 },
  { pattern: "youtube", category: "bills/subscriptions", priority: 30 },
  { pattern: "verizon", category: "bills/phone-internet", priority: 30 },
  { pattern: "at&t", category: "bills/phone-internet", priority: 30 },
  {
    pattern: "\\batt\\b",
    category: "bills/phone-internet",
    field: "raw",
    matchType: "regex",
    priority: 30,
  },
  { pattern: "t-mobile", category: "bills/phone-internet", priority: 30 },
  { pattern: "xfinity", category: "bills/phone-internet", priority: 30 },
  { pattern: "spectrum", category: "bills/phone-internet", priority: 30 },
  {
    pattern: "planet fitness",
    category: "bills/gym-memberships",
    priority: 30,
  },
  // insurance and housing
  {
    pattern: "geico|progressive|state farm|allstate|usaa",
    category: "home/insurance",
    matchType: "regex",
    priority: 30,
  },
  {
    pattern: "realty|property management|apartments|rent payment",
    category: "home/rent-mortgage",
    matchType: "regex",
    priority: 45,
  },
  // travel
  { pattern: "airlines", category: "fun/travel", field: "raw", priority: 30 },
  { pattern: "hyatt", category: "fun/travel", priority: 30 },
  { pattern: "marriott", category: "fun/travel", priority: 30 },
  { pattern: "hilton", category: "fun/travel", priority: 30 },
  { pattern: "resort", category: "fun/travel", priority: 33 },
  { pattern: "airbnb", category: "fun/travel", priority: 30 },
  // giving
  { pattern: "gofundme", category: "gifts/gifts-giving", priority: 30 },
  // health
  { pattern: "cvs", category: "health/medical-pharmacy", priority: 30 },
  { pattern: "walgreens", category: "health/medical-pharmacy", priority: 30 },
  // Eating out. Chains first, then a keyword catch-all at the very back of the
  // queue: the dry run on real data showed restaurants were the largest
  // uncategorized block, and correcting an occasional wrong guess in Review is
  // far quicker than categorizing every one of them by hand.
  {
    pattern:
      "chick-fil-a|chipotle|whataburger|in-n-out|panera|wingstop|raising cane|sonic|wendy|mcdonald|burger king|taco bell|jimmy john|fuzzy|hopdoddy|cava|torchy|five guys|shake shack|olive garden|applebee|chili|ihop|denny|waffle house|cracker barrel|panda express|subway",
    category: "food/restaurants",
    matchType: "regex",
    priority: 44,
  },
  {
    pattern: "\\bcoffee\\b",
    category: "food/coffee-takeout",
    matchType: "regex",
    priority: 59,
  },
  {
    pattern:
      "\\b(cafe|caf[eé]|grill|kitchen|pizza|pizzeria|taco|tacos|bbq|barbecue|tap|tavern|bistro|cocina|eatery|diner|burger|burgers|sushi|ramen|pho|steak|steakhouse|brewing|brewery|restaurant|cantina|deli|bakery|donut|donuts|ice cream|gelato|wings|smokehouse|taqueria|coffee)\\b",
    category: "food/restaurants",
    matchType: "regex",
    priority: 60,
  },
];

/**
 * Resolve each builtin rule's target leaf. A seed key the user has deleted
 * (see `DELETED_SEED_KEYS`) resolves to nothing: its rules are skipped and
 * any rows already seeded for it are pruned. A key that is neither present
 * nor tombstoned is a mismatch between BUILTIN_RULES and DEFAULT_CATEGORIES,
 * and throws.
 */
function resolveBuiltinTargets(db: Db): Map<string, number> {
  const deleted = deletedSeedKeys(db);
  const ids = new Map<string, number>();
  for (const r of BUILTIN_RULES) {
    if (ids.has(r.category) || deleted.has(r.category)) continue;
    const categoryId = findCategoryIdBySeedKey(db, r.category);
    if (categoryId === undefined)
      throw new Error(
        `Builtin rule references unknown category seed key ${r.category}`,
      );
    ids.set(r.category, categoryId);
  }
  return ids;
}

export function ensureBuiltinRules(db: Db): void {
  ensureDefaultCategories(db);
  const targets = resolveBuiltinTargets(db);
  for (const r of BUILTIN_RULES) {
    const categoryId = targets.get(r.category);
    if (categoryId === undefined) continue;
    const exists = db
      .select()
      .from(rules)
      .where(
        and(
          eq(rules.builtin, true),
          eq(rules.pattern, r.pattern),
          eq(rules.categoryId, categoryId),
        ),
      )
      .get();
    if (exists) {
      // Keep an already-seeded rule in step with the table above — a changed
      // priority (fees moving ahead of payee rules, say) has to reach existing
      // databases, not just new ones. `enabled` is left alone: archiving a
      // category switches its builtin rules off deliberately.
      const field = r.field ?? "merchant";
      const matchType = r.matchType ?? "contains";
      const priority = r.priority ?? 50;
      const direction = r.direction ?? "any";
      if (
        exists.field !== field ||
        exists.matchType !== matchType ||
        exists.priority !== priority ||
        exists.direction !== direction
      )
        db.update(rules)
          .set({ field, matchType, priority, direction })
          .where(eq(rules.id, exists.id))
          .run();
      continue;
    }
    db.insert(rules)
      .values({
        pattern: r.pattern,
        field: r.field ?? "merchant",
        matchType: r.matchType ?? "contains",
        priority: r.priority ?? 50,
        categoryId,
        builtin: true,
        direction: r.direction ?? "any",
      })
      .run();
  }

  // Prune builtin rules that are no longer in BUILTIN_RULES, or whose target
  // leaf the user has since deleted.
  const currentKeys = new Set<string>();
  for (const r of BUILTIN_RULES) {
    const categoryId = targets.get(r.category);
    if (categoryId === undefined) continue;
    currentKeys.add(`${r.pattern}${categoryId}`);
  }

  const allBuiltin = db
    .select()
    .from(rules)
    .where(eq(rules.builtin, true))
    .all();

  for (const builtinRule of allBuiltin) {
    const key = `${builtinRule.pattern}${builtinRule.categoryId}`;
    if (!currentKeys.has(key)) {
      db.delete(rules).where(eq(rules.id, builtinRule.id)).run();
    }
  }
}
