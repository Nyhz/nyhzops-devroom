CREATE TABLE `captain_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`campaign_id` text,
	`battlefield_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`reasoning` text NOT NULL,
	`confidence` text NOT NULL,
	`escalated` integer DEFAULT 0,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`battlefield_id`) REFERENCES `battlefields`(`id`) ON UPDATE no action ON DELETE no action
);
