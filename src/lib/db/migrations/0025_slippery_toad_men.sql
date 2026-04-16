PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_missions` (
	`id` text PRIMARY KEY NOT NULL,
	`battlefield_id` text NOT NULL,
	`campaign_id` text,
	`phase_id` text,
	`type` text DEFAULT 'combat' NOT NULL,
	`title` text NOT NULL,
	`briefing` text NOT NULL,
	`status` text DEFAULT 'standby',
	`priority` text DEFAULT 'routine',
	`asset_id` text,
	`use_worktree` integer DEFAULT 0,
	`worktree_branch` text,
	`depends_on` text,
	`session_id` text,
	`debrief` text,
	`debrief_structured` text,
	`iterations` integer DEFAULT 0,
	`cost_input` integer DEFAULT 0,
	`cost_output` integer DEFAULT 0,
	`cost_cache_hit` integer DEFAULT 0,
	`review_attempts` integer DEFAULT 0,
	`compromise_reason` text,
	`next_attempt_at` integer,
	`infrastructure_retry_count` integer DEFAULT 0 NOT NULL,
	`recon_violated_readonly` integer DEFAULT 0 NOT NULL,
	`current_sortie_attempts` integer DEFAULT 0 NOT NULL,
	`merge_retry_at` integer,
	`merge_result` text,
	`merge_conflict_files` text,
	`merge_timestamp` integer,
	`skill_overrides` text,
	`duration_ms` integer DEFAULT 0,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`battlefield_id`) REFERENCES `battlefields`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`phase_id`) REFERENCES `phases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_missions`("id", "battlefield_id", "campaign_id", "phase_id", "type", "title", "briefing", "status", "priority", "asset_id", "use_worktree", "worktree_branch", "depends_on", "session_id", "debrief", "debrief_structured", "iterations", "cost_input", "cost_output", "cost_cache_hit", "review_attempts", "compromise_reason", "next_attempt_at", "infrastructure_retry_count", "recon_violated_readonly", "current_sortie_attempts", "merge_retry_at", "merge_result", "merge_conflict_files", "merge_timestamp", "skill_overrides", "duration_ms", "started_at", "completed_at", "created_at", "updated_at") SELECT "id", "battlefield_id", "campaign_id", "phase_id", "type", "title", "briefing", "status", "priority", "asset_id", "use_worktree", "worktree_branch", "depends_on", "session_id", "debrief", NULL, "iterations", "cost_input", "cost_output", "cost_cache_hit", "review_attempts", "compromise_reason", NULL, 0, 0, 0, "merge_retry_at", "merge_result", "merge_conflict_files", "merge_timestamp", "skill_overrides", "duration_ms", "started_at", "completed_at", "created_at", "updated_at" FROM `missions`;--> statement-breakpoint
DROP TABLE `missions`;--> statement-breakpoint
ALTER TABLE `__new_missions` RENAME TO `missions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `battlefields` ADD `gate_manifest` text;--> statement-breakpoint
ALTER TABLE `battlefields` ADD `needs_gate_manifest` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `battlefields` ADD `main_is_red` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `battlefields` ADD `override_main_red_guard` integer DEFAULT 0 NOT NULL;