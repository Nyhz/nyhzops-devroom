CREATE TABLE `managed_app_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`ts` integer NOT NULL,
	`bucket` text NOT NULL,
	`rss` integer,
	`cpu` real,
	`healthy` integer,
	`http_code` integer,
	`latency_ms` integer
);
--> statement-breakpoint
CREATE INDEX `mam_slug_ts` ON `managed_app_metrics` (`slug`,`ts`);--> statement-breakpoint
CREATE INDEX `mam_bucket_ts` ON `managed_app_metrics` (`bucket`,`ts`);--> statement-breakpoint
CREATE TABLE `managed_apps` (
	`slug` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`battlefield_id` text,
	`launchd_label` text NOT NULL,
	`ctl_script_path` text NOT NULL,
	`log_path` text NOT NULL,
	`health_url` text,
	`order_idx` integer DEFAULT 0 NOT NULL,
	`is_self_controlled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`battlefield_id`) REFERENCES `battlefields`(`id`) ON UPDATE no action ON DELETE no action
);
