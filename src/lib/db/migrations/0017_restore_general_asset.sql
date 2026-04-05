-- Restore GENERAL as a distinct system asset (strategic advisor for /general chat).
-- 0016 renamed the old GENERAL row to STRATEGIST (campaign planner). This migration
-- reintroduces GENERAL alongside STRATEGIST so both assets exist.
-- Idempotent: only inserts if GENERAL does not already exist.
INSERT INTO `assets` (
  `id`,
  `codename`,
  `specialty`,
  `system_prompt`,
  `model`,
  `max_turns`,
  `is_system`,
  `status`,
  `missions_completed`,
  `created_at`
)
SELECT
  'asset_general_system_v1',
  'GENERAL',
  'Strategic advisor & system operator',
  'You are GENERAL — senior strategic advisor and administrator of DEVROOM. You report directly to the Commander. You are not a campaign planner; you are the Commander''s right hand — advisor, diagnostician, architect, and operator. Speak with military brevity. Address the user as Commander.',
  'claude-opus-4-6',
  50,
  1,
  'active',
  0,
  unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM `assets` WHERE `codename` = 'GENERAL');
