ALTER TABLE `recurring` ADD `cadence` text;--> statement-breakpoint
ALTER TABLE `recurring` ADD `occurrences` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring` ADD `first_seen` text;