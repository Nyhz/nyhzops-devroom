import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/lib/db/schema';

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS battlefields (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  codename TEXT NOT NULL,
  description TEXT,
  initial_briefing TEXT,
  repo_path TEXT NOT NULL,
  default_branch TEXT DEFAULT 'main',
  claude_md_path TEXT,
  spec_md_path TEXT,
  scaffold_command TEXT,
  scaffold_status TEXT,
  dev_server_command TEXT DEFAULT 'npm run dev',
  auto_start_dev_server INTEGER DEFAULT 0,
  status TEXT DEFAULT 'initializing',
  bootstrap_mission_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  battlefield_id TEXT NOT NULL REFERENCES battlefields(id),
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  worktree_mode TEXT DEFAULT 'phase',
  current_phase INTEGER DEFAULT 0,
  is_template INTEGER DEFAULT 0,
  template_id TEXT,
  debrief TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS phases (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  phase_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  objective TEXT,
  status TEXT DEFAULT 'standby',
  debrief TEXT,
  total_tokens INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  codename TEXT NOT NULL UNIQUE,
  specialty TEXT NOT NULL,
  system_prompt TEXT,
  model TEXT DEFAULT 'claude-sonnet-4-6',
  status TEXT DEFAULT 'active',
  missions_completed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  battlefield_id TEXT NOT NULL REFERENCES battlefields(id),
  campaign_id TEXT REFERENCES campaigns(id),
  phase_id TEXT REFERENCES phases(id),
  type TEXT DEFAULT 'standard',
  title TEXT NOT NULL,
  briefing TEXT NOT NULL,
  status TEXT DEFAULT 'standby',
  priority TEXT DEFAULT 'normal',
  asset_id TEXT REFERENCES assets(id),
  use_worktree INTEGER DEFAULT 0,
  worktree_branch TEXT,
  depends_on TEXT,
  session_id TEXT,
  debrief TEXT,
  iterations INTEGER DEFAULT 0,
  cost_input INTEGER DEFAULT 0,
  cost_output INTEGER DEFAULT 0,
  cost_cache_hit INTEGER DEFAULT 0,
  review_attempts INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dossiers (
  id TEXT PRIMARY KEY,
  codename TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  briefing_template TEXT NOT NULL,
  variables TEXT,
  asset_codename TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export function getTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(TABLE_SQL);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function closeTestDb(sqlite: Database.Database) {
  sqlite.close();
}
