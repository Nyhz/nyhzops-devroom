-- Clean-slate migration for CONTROL refactor cutover.
-- Preserves: battlefields (flagged needs_gate_manifest), assets (reseeded), dossiers, settings, scheduledTasks.
-- Wipes: all operational data.

DELETE FROM mission_attempts;--> statement-breakpoint
DELETE FROM comms;--> statement-breakpoint
DELETE FROM mission_logs;--> statement-breakpoint
DELETE FROM overseer_logs;--> statement-breakpoint
DELETE FROM follow_up_suggestions;--> statement-breakpoint
DELETE FROM intel_notes WHERE mission_id IS NOT NULL;--> statement-breakpoint
DELETE FROM missions;--> statement-breakpoint
DELETE FROM phases;--> statement-breakpoint
DELETE FROM campaigns;--> statement-breakpoint
UPDATE battlefields SET needs_gate_manifest = 1, main_is_red = 0, override_main_red_guard = 0, gate_manifest = NULL;--> statement-breakpoint
DELETE FROM assets;
