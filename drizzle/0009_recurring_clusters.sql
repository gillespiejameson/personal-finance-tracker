ALTER TABLE `recurring` ADD `amount_key` integer;--> statement-breakpoint
ALTER TABLE `recurring` ADD `manual` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring` ADD `confidence` text DEFAULT 'confirmed' NOT NULL;