-- Clean-slate migration for CONTROL refactor cutover.
-- Preserves: battlefields (flagged needs_gate_manifest), assets (reseeded), dossiers, settings, scheduledTasks.
-- Wipes: all operational data.

DELETE FROM mission_attempts;
DELETE FROM comms;
DELETE FROM mission_logs;
DELETE FROM overseer_logs;
DELETE FROM follow_up_suggestions;
DELETE FROM intel_notes WHERE mission_id IS NOT NULL;
DELETE FROM missions;
DELETE FROM phases;
DELETE FROM campaigns;

-- Flag all existing battlefields for gate manifest establishment.
UPDATE battlefields SET needs_gate_manifest = 1, main_is_red = 0, override_main_red_guard = 0, gate_manifest = NULL;

-- Assets will be reseeded by scripts/seed.ts after migration.
DELETE FROM assets;
