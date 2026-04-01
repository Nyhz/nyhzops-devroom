ALTER TABLE `assets` ADD `skills` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `mcp_servers` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `max_turns` integer;--> statement-breakpoint
ALTER TABLE `assets` ADD `effort` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `is_system` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `missions` ADD `skill_overrides` text;
