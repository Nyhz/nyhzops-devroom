CREATE TABLE `intel_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`battlefield_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`column` text DEFAULT 'backlog',
	`position` integer DEFAULT 0,
	`mission_id` text,
	`campaign_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`battlefield_id`) REFERENCES `battlefields`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
