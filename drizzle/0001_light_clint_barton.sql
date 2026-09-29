ALTER TABLE `merchant_aliases` ADD `builtin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `field` text DEFAULT 'merchant' NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `builtin` integer DEFAULT false NOT NULL;