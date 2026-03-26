CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`codename` text NOT NULL,
	`specialty` text NOT NULL,
	`system_prompt` text,
	`model` text DEFAULT 'claude-sonnet-4-6',
	`status` text DEFAULT 'active',
	`missions_completed` integer DEFAULT 0,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_codename_unique` ON `assets` (`codename`);--> statement-breakpoint
CREATE TABLE `battlefields` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`codename` text NOT NULL,
	`description` text,
	`initial_briefing` text,
	`repo_path` text NOT NULL,
	`default_branch` text DEFAULT 'main',
	`claude_md_path` text,
	`spec_md_path` text,
	`scaffold_command` text,
	`dev_server_command` text DEFAULT 'npm run dev',
	`auto_start_dev_server` integer DEFAULT 0,
	`status` text DEFAULT 'initializing',
	`bootstrap_mission_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`battlefield_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text NOT NULL,
	`status` text DEFAULT 'draft',
	`worktree_mode` text DEFAULT 'phase',
	`current_phase` integer DEFAULT 0,
	`is_template` integer DEFAULT 0,
	`template_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`battlefield_id`) REFERENCES `battlefields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `command_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`battlefield_id` text NOT NULL,
	`command` text NOT NULL,
	`exit_code` integer,
	`duration_ms` integer DEFAULT 0,
	`output` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`battlefield_id`) REFERENCES `battlefields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mission_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `missions` (
	`id` text PRIMARY KEY NOT NULL,
	`battlefield_id` text NOT NULL,
	`campaign_id` text,
	`phase_id` text,
	`type` text DEFAULT 'standard',
	`title` text NOT NULL,
	`briefing` text NOT NULL,
	`status` text DEFAULT 'standby',
	`priority` text DEFAULT 'normal',
	`asset_id` text,
	`use_worktree` integer DEFAULT 0,
	`worktree_branch` text,
	`session_id` text,
	`debrief` text,
	`iterations` integer DEFAULT 0,
	`cost_input` integer DEFAULT 0,
	`cost_output` integer DEFAULT 0,
	`cost_cache_hit` integer DEFAULT 0,
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
CREATE TABLE `phases` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`phase_number` integer NOT NULL,
	`name` text NOT NULL,
	`objective` text,
	`status` text DEFAULT 'standby',
	`debrief` text,
	`total_tokens` integer DEFAULT 0,
	`duration_ms` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`battlefield_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`cron` text NOT NULL,
	`enabled` integer DEFAULT 1,
	`mission_template` text,
	`campaign_id` text,
	`last_run_at` integer,
	`next_run_at` integer,
	`run_count` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`battlefield_id`) REFERENCES `battlefields`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
