import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const bankProfiles = sqliteTable("bank_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  headerSignature: text("header_signature").notNull().unique(),
  dateCol: text("date_col").notNull(),
  descCol: text("desc_col").notNull(),
  amountCol: text("amount_col"),
  debitCol: text("debit_col"),
  creditCol: text("credit_col"),
  balanceCol: text("balance_col"),
  dateFormat: text("date_format", { enum: ["MDY", "DMY", "YMD"] }).notNull(),
  signConvention: text("sign_convention", {
    enum: ["outflow_negative", "outflow_positive", "debit_credit_cols"],
  }).notNull(),
  skipRows: integer("skip_rows").notNull().default(0),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
});

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["checking", "savings", "credit", "cash", "loan", "investment"],
  }).notNull(),
  institution: text("institution"),
  bankProfileId: integer("bank_profile_id").references(() => bankProfiles.id),
  color: text("color").notNull().default("#0A84FF"),
  createdAt: text("created_at").notNull().default(now),
  aprBps: integer("apr_bps"),
  minPaymentCents: integer("min_payment_cents"),
});

export const imports = sqliteTable("imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  filename: text("filename").notNull(),
  fileHash: text("file_hash").notNull().unique(),
  importedAt: text("imported_at").notNull().default(now),
  rowCount: integer("row_count").notNull(),
  newCount: integer("new_count").notNull(),
  dupCount: integer("dup_count").notNull(),
  flaggedCount: integer("flagged_count").notNull().default(0),
  backupPath: text("backup_path"),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parentId: integer("parent_id"),
  name: text("name").notNull(),
  /**
   * Stable identity of a seeded category ("debt/card-payments"), independent
   * of the name the user may have given it. Null for user-created categories.
   */
  seedKey: text("seed_key"),
  kind: text("kind", {
    enum: ["income", "expense", "transfer", "system"],
  }).notNull(),
  isFixed: integer("is_fixed", { mode: "boolean" }).notNull().default(false),
  rollover: integer("rollover", { mode: "boolean" }).notNull().default(false),
  color: text("color").notNull(),
  icon: text("icon").notNull().default("circle"),
  sort: integer("sort").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    importId: integer("import_id").references(() => imports.id, {
      onDelete: "cascade",
    }),
    date: text("date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    rawDescription: text("raw_description").notNull(),
    merchant: text("merchant").notNull(),
    categoryId: integer("category_id").references(() => categories.id),
    isTransfer: integer("is_transfer", { mode: "boolean" })
      .notNull()
      .default(false),
    possibleDuplicate: integer("possible_duplicate", { mode: "boolean" })
      .notNull()
      .default(false),
    suspectedRefundOf: integer("suspected_refund_of"),
    notes: text("notes"),
    dedupeHash: text("dedupe_hash").notNull(),
    reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
    /** SimpleFIN transaction id; null for rows that came from a CSV/OFX file. */
    externalId: text("external_id"),
    /** Still pending at the bank (SimpleFIN `posted` = 0); cleared on posting. */
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("transactions_dedupe_hash_idx").on(t.dedupeHash),
    index("transactions_date_idx").on(t.date),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    uniqueIndex("transactions_account_external_idx")
      .on(t.accountId, t.externalId)
      .where(sql`external_id is not null`),
  ],
);

export const transferPairs = sqliteTable("transfer_pairs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromTxnId: integer("from_txn_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  toTxnId: integer("to_txn_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  confidence: integer("confidence").notNull().default(100),
});

export const transactionSplits = sqliteTable("transaction_splits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  transactionId: integer("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  amountCents: integer("amount_cents").notNull(),
  notes: text("notes"),
});

export const merchantAliases = sqliteTable("merchant_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pattern: text("pattern").notNull(),
  matchType: text("match_type", { enum: ["contains", "regex"] })
    .notNull()
    .default("contains"),
  merchant: text("merchant").notNull(),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
});

export const rules = sqliteTable("rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  priority: integer("priority").notNull().default(100),
  matchType: text("match_type", { enum: ["contains", "regex"] })
    .notNull()
    .default("contains"),
  pattern: text("pattern").notNull(),
  field: text("field", { enum: ["merchant", "raw"] })
    .notNull()
    .default("merchant"),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
  minCents: integer("min_cents"),
  maxCents: integer("max_cents"),
  accountId: integer("account_id").references(() => accounts.id),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  hitCount: integer("hit_count").notNull().default(0),
  lastHit: text("last_hit"),
  /** Which sign of amount the rule applies to: inflows, outflows or either. */
  direction: text("direction", { enum: ["in", "out", "any"] })
    .notNull()
    .default("any"),
});

export const budgets = sqliteTable(
  "budgets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    month: text("month").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [uniqueIndex("budgets_month_category_idx").on(t.month, t.categoryId)],
);

export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  targetCents: integer("target_cents").notNull(),
  targetDate: text("target_date"),
  categoryId: integer("category_id").references(() => categories.id),
  currentCents: integer("current_cents").notNull().default(0),
  startDate: text("start_date"),
  startingCents: integer("starting_cents").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const recurring = sqliteTable("recurring", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  merchant: text("merchant").notNull(),
  cadence: text("cadence", {
    enum: ["weekly", "biweekly", "monthly", "quarterly", "annual"],
  }),
  occurrences: integer("occurrences").notNull().default(0),
  firstSeen: text("first_seen"),
  categoryId: integer("category_id").references(() => categories.id),
  avgCents: integer("avg_cents").notNull(),
  intervalDays: integer("interval_days").notNull(),
  toleranceCents: integer("tolerance_cents").notNull().default(0),
  lastSeen: text("last_seen").notNull(),
  nextExpected: text("next_expected").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
  /**
   * Dollar-rounded center of the amount cluster this row describes; with the
   * direction and merchant it identifies the row across refreshes. Null on
   * rows written before Phase 7a (refresh fills it in).
   */
  amountKey: integer("amount_key"),
  /** Created by "Mark as bill"; detection never deletes or overwrites it. */
  manual: integer("manual", { mode: "boolean" }).notNull().default(false),
  confidence: text("confidence", { enum: ["confirmed", "likely", "manual"] })
    .notNull()
    .default("confirmed"),
});

export const plannedExpenses = sqliteTable("planned_expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  amountCents: integer("amount_cents").notNull(),
  dueDate: text("due_date").notNull(),
  every: text("every", { enum: ["year", "quarter", "once"] }).notNull(),
  categoryId: integer("category_id").references(() => categories.id),
  createdAt: text("created_at").notNull().default(now),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    date: text("date").notNull(),
    balanceCents: integer("balance_cents").notNull(),
  },
  (t) => [
    uniqueIndex("balance_snapshots_account_date_idx").on(t.accountId, t.date),
  ],
);

/** Accounts SimpleFIN reports for the connected token; `accountId` maps one to an app account. */
export const simplefinAccounts = sqliteTable("simplefin_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sfinId: text("sfin_id").notNull().unique(),
  orgName: text("org_name"),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("USD"),
  balanceCents: integer("balance_cents"),
  balanceDate: text("balance_date"),
  accountId: integer("account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastSyncedAt: text("last_synced_at"),
});

export const weeklyReviews = sqliteTable("weekly_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  completedAt: text("completed_at").notNull().default(now),
  weekStart: text("week_start").notNull(),
});
