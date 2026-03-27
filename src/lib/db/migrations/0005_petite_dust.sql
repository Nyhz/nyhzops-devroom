CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`battlefield_id` text,
	`read` integer DEFAULT 0,
	`telegram_sent` integer DEFAULT 0,
	`telegram_msg_id` integer,
	`created_at` integer NOT NULL
);
