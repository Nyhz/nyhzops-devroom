CREATE INDEX `idx_comms_mission` ON `comms` (`mission_id`);--> statement-breakpoint
CREATE INDEX `idx_comms_campaign` ON `comms` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `idx_comms_battlefield` ON `comms` (`battlefield_id`);--> statement-breakpoint
CREATE INDEX `idx_mission_attempts_mission` ON `mission_attempts` (`mission_id`);--> statement-breakpoint
CREATE INDEX `idx_missions_status` ON `missions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_missions_battlefield` ON `missions` (`battlefield_id`);--> statement-breakpoint
CREATE INDEX `idx_missions_bf_status` ON `missions` (`battlefield_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_notifications_read_created` ON `notifications` (`read`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_overseer_logs_mission` ON `overseer_logs` (`mission_id`);