CREATE TABLE `dossiers` (
	`id` text PRIMARY KEY NOT NULL,
	`codename` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`briefing_template` text NOT NULL,
	`variables` text,
	`asset_codename` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dossiers_codename_unique` ON `dossiers` (`codename`);