CREATE TABLE `comms` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text,
	`campaign_id` text,
	`battlefield_id` text,
	`actor` text NOT NULL,
	`message` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`created_at` integer NOT NULL
);
