CREATE TABLE `simplefin_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sfin_id` text NOT NULL,
	`org_name` text,
	`name` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`balance_cents` integer,
	`balance_date` text,
	`account_id` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `simplefin_accounts_sfin_id_unique` ON `simplefin_accounts` (`sfin_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `pending` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_account_external_idx` ON `transactions` (`account_id`,`external_id`) WHERE external_id is not null;