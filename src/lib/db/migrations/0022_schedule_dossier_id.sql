ALTER TABLE scheduled_tasks ADD COLUMN dossier_id TEXT;

-- Backfill existing WORKTREE SWEEP tasks
UPDATE scheduled_tasks SET dossier_id = 'worktree-sweep' WHERE name = 'WORKTREE SWEEP' AND type = 'maintenance';
