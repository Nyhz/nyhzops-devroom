CREATE TABLE `test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`battlefield_id` text NOT NULL,
	`framework` text NOT NULL,
	`command` text NOT NULL,
	`pattern` text,
	`status` text DEFAULT 'running' NOT NULL,
	`total_tests` integer DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`coverage_percent` integer,
	`results` text,
	`raw_output` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`battlefield_id`) REFERENCES `battlefields`(`id`) ON UPDATE no action ON DELETE no action
);
