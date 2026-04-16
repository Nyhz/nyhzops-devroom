CREATE TABLE `mission_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text,
	`classification` text,
	`gate_results` text,
	`debrief_synthesized` integer DEFAULT 0 NOT NULL,
	`auto_committed` integer DEFAULT 0 NOT NULL,
	`tokens_input` integer DEFAULT 0 NOT NULL,
	`tokens_output` integer DEFAULT 0 NOT NULL,
	`tokens_cache` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`session_id` text,
	`target_head_at_start` text,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE no action
);