import { PARENT_COLORS, type ParentKey } from "./palette";

type LeafInput = { name: string; isFixed?: boolean };
export type DefaultLeaf = LeafInput & { seedKey: string };
export type DefaultParent = {
  key: ParentKey;
  name: string;
  kind: "income" | "expense" | "transfer" | "system";
  color: string;
  icon: string;
  isFixed: boolean;
  seedKey: string;
  leaves: DefaultLeaf[];
};

/**
 * Bumped whenever DEFAULT_CATEGORIES changes. `ensureDefaultCategories` skips
 * its sweep entirely while the database already records this version, which
 * matters because the sweep sits on hot paths (every transaction listing,
 * every transfer pass).
 */
export const CATEGORIES_SEED_VERSION = 2;
export const CATEGORIES_SEED_VERSION_KEY = "categories_seed_version";

/** "Card payments" -> "card-payments" */
export function seedSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const p = (
  key: ParentKey,
  name: string,
  kind: DefaultParent["kind"],
  icon: string,
  isFixed: boolean,
  leaves: LeafInput[],
): DefaultParent => ({
  key,
  name,
  kind,
  icon,
  isFixed,
  color: PARENT_COLORS[key],
  seedKey: key,
  leaves: leaves.map((l) => ({ ...l, seedKey: `${key}/${seedSlug(l.name)}` })),
});

export const DEFAULT_CATEGORIES: DefaultParent[] = [
  p("income", "Income", "income", "banknote", false, [
    { name: "Paycheck" },
    { name: "Side income" },
    { name: "Other income" },
  ]),
  p("home", "Home", "expense", "house", true, [
    { name: "Rent/Mortgage", isFixed: true },
    { name: "Utilities", isFixed: true },
    { name: "Insurance", isFixed: true },
    { name: "Repairs & household" },
  ]),
  p("transport", "Car & Transport", "expense", "car", false, [
    { name: "Fuel" },
    { name: "Car payment & insurance", isFixed: true },
    { name: "Repairs, parking & transit" },
  ]),
  p("food", "Food", "expense", "utensils", false, [
    { name: "Groceries" },
    { name: "Restaurants" },
    { name: "Coffee & takeout" },
  ]),
  p("bills", "Bills & Subscriptions", "expense", "receipt", true, [
    { name: "Phone & internet", isFixed: true },
    { name: "Subscriptions", isFixed: true },
    { name: "Gym & memberships", isFixed: true },
  ]),
  p("health", "Health", "expense", "heart-pulse", false, [
    { name: "Medical & pharmacy" },
  ]),
  p("shopping", "Shopping", "expense", "shopping-bag", false, [
    { name: "Clothing & personal care" },
    { name: "General" },
  ]),
  p("fun", "Fun", "expense", "party-popper", false, [
    { name: "Entertainment" },
    { name: "Hobbies" },
    { name: "Travel" },
  ]),
  p("gifts", "Gifts & Giving", "expense", "gift", false, [
    { name: "Gifts & giving" },
  ]),
  p("debt", "Debt", "expense", "credit-card", true, [
    { name: "Loan payments", isFixed: true },
    { name: "Card payments", isFixed: true },
    { name: "Interest & fees" },
  ]),
  p("savings", "Savings & Investing", "expense", "piggy-bank", true, [
    { name: "Savings & investing", isFixed: true },
  ]),
  // System categories have no leaves; they are assigned directly (so findCategoryId("Transfer") is unambiguous).
  p("transfer", "Transfer", "transfer", "arrow-left-right", false, []),
  p("uncategorized", "Uncategorized", "system", "circle-dashed", false, []),
];
