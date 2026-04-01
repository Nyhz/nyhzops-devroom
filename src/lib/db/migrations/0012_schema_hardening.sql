ALTER TABLE `missions` ADD `compromise_reason` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `merge_retry_at` integer;--> statement-breakpoint
ALTER TABLE `phases` ADD `completing_at` integer;--> statement-breakpoint
ALTER TABLE `captain_logs` RENAME TO `overseer_logs`;--> statement-breakpoint
CREATE UNIQUE INDEX `briefing_sessions_campaign_id_unique` ON `briefing_sessions` (`campaign_id`);
