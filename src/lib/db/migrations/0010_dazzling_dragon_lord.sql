CREATE TABLE `follow_up_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`battlefield_id` text NOT NULL,
	`mission_id` text,
	`campaign_id` text,
	`suggestion` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`intel_note_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`battlefield_id`) REFERENCES `battlefields`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intel_note_id`) REFERENCES `intel_notes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `debrief` text;