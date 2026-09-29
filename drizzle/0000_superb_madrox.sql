CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`institution` text,
	`bank_profile_id` integer,
	`color` text DEFAULT '#0A84FF' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`bank_profile_id`) REFERENCES `bank_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`date` text NOT NULL,
	`balance_cents` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bank_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`header_signature` text NOT NULL,
	`date_col` text NOT NULL,
	`desc_col` text NOT NULL,
	`amount_col` text,
	`debit_col` text,
	`credit_col` text,
	`balance_col` text,
	`date_format` text NOT NULL,
	`sign_convention` text NOT NULL,
	`skip_rows` integer DEFAULT 0 NOT NULL,
	`builtin` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_profiles_header_signature_unique` ON `bank_profiles` (`header_signature`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`category_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_month_category_idx` ON `budgets` (`month`,`category_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`is_fixed` integer DEFAULT false NOT NULL,
	`rollover` integer DEFAULT false NOT NULL,
	`color` text NOT NULL,
	`icon` text DEFAULT 'circle' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`target_cents` integer NOT NULL,
	`target_date` text,
	`category_id` integer,
	`current_cents` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`filename` text NOT NULL,
	`file_hash` text NOT NULL,
	`imported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`row_count` integer NOT NULL,
	`new_count` integer NOT NULL,
	`dup_count` integer NOT NULL,
	`flagged_count` integer DEFAULT 0 NOT NULL,
	`backup_path` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imports_file_hash_unique` ON `imports` (`file_hash`);--> statement-breakpoint
CREATE TABLE `merchant_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern` text NOT NULL,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`merchant` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant` text NOT NULL,
	`category_id` integer,
	`avg_cents` integer NOT NULL,
	`interval_days` integer NOT NULL,
	`tolerance_cents` integer DEFAULT 0 NOT NULL,
	`last_seen` text NOT NULL,
	`next_expected` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`pattern` text NOT NULL,
	`min_cents` integer,
	`max_cents` integer,
	`account_id` integer,
	`category_id` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`last_hit` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`import_id` integer,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`raw_description` text NOT NULL,
	`merchant` text NOT NULL,
	`category_id` integer,
	`is_transfer` integer DEFAULT false NOT NULL,
	`possible_duplicate` integer DEFAULT false NOT NULL,
	`suspected_refund_of` integer,
	`notes` text,
	`dedupe_hash` text NOT NULL,
	`reviewed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_dedupe_hash_idx` ON `transactions` (`dedupe_hash`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_account_date_idx` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `transfer_pairs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_txn_id` integer NOT NULL,
	`to_txn_id` integer NOT NULL,
	`confidence` integer DEFAULT 100 NOT NULL,
	FOREIGN KEY (`from_txn_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_txn_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `weekly_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`completed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`week_start` text NOT NULL
);
