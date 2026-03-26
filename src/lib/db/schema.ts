import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// Battlefields (Projects)
// ---------------------------------------------------------------------------
export const battlefields = sqliteTable('battlefields', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  codename: text('codename').notNull(),
  description: text('description'),
  initialBriefing: text('initial_briefing'),
  repoPath: text('repo_path').notNull(),
  defaultBranch: text('default_branch').default('main'),
  claudeMdPath: text('claude_md_path'),
  specMdPath: text('spec_md_path'),
  scaffoldCommand: text('scaffold_command'),
  scaffoldStatus: text('scaffold_status'),  // null | 'running' | 'complete' | 'failed'
  devServerCommand: text('dev_server_command').default('npm run dev'),
  autoStartDevServer: integer('auto_start_dev_server').default(0),
  status: text('status').default('initializing'),
  bootstrapMissionId: text('bootstrap_mission_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Missions (Tasks)
// ---------------------------------------------------------------------------
export const missions = sqliteTable('missions', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  campaignId: text('campaign_id').references(() => campaigns.id),
  phaseId: text('phase_id').references(() => phases.id),
  type: text('type').default('standard'),
  title: text('title').notNull(),
  briefing: text('briefing').notNull(),
  status: text('status').default('standby'),
  priority: text('priority').default('normal'),
  assetId: text('asset_id').references(() => assets.id),
  useWorktree: integer('use_worktree').default(0),
  worktreeBranch: text('worktree_branch'),
  sessionId: text('session_id'),
  debrief: text('debrief'),
  iterations: integer('iterations').default(0),
  costInput: integer('cost_input').default(0),
  costOutput: integer('cost_output').default(0),
  costCacheHit: integer('cost_cache_hit').default(0),
  durationMs: integer('duration_ms').default(0),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Campaigns (Multi-phase operations)
// ---------------------------------------------------------------------------
export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  name: text('name').notNull(),
  objective: text('objective').notNull(),
  status: text('status').default('draft'),
  worktreeMode: text('worktree_mode').default('phase'),
  currentPhase: integer('current_phase').default(0),
  isTemplate: integer('is_template').default(0),
  templateId: text('template_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Phases (Campaign steps)
// ---------------------------------------------------------------------------
export const phases = sqliteTable('phases', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  phaseNumber: integer('phase_number').notNull(),
  name: text('name').notNull(),
  objective: text('objective'),
  status: text('status').default('standby'),
  debrief: text('debrief'),
  totalTokens: integer('total_tokens').default(0),
  durationMs: integer('duration_ms').default(0),
  createdAt: integer('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// Assets (Agent profiles)
// ---------------------------------------------------------------------------
export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  codename: text('codename').notNull().unique(),
  specialty: text('specialty').notNull(),
  systemPrompt: text('system_prompt'),
  model: text('model').default('claude-sonnet-4-6'),
  status: text('status').default('active'),
  missionsCompleted: integer('missions_completed').default(0),
  createdAt: integer('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// Mission Logs (Comms)
// ---------------------------------------------------------------------------
export const missionLogs = sqliteTable('mission_logs', {
  id: text('id').primaryKey(),
  missionId: text('mission_id').notNull().references(() => missions.id),
  timestamp: integer('timestamp').notNull(),
  type: text('type').notNull(),
  content: text('content').notNull(),
});

// ---------------------------------------------------------------------------
// Scheduled Tasks
// ---------------------------------------------------------------------------
export const scheduledTasks = sqliteTable('scheduled_tasks', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  cron: text('cron').notNull(),
  enabled: integer('enabled').default(1),
  missionTemplate: text('mission_template'),
  campaignId: text('campaign_id').references(() => campaigns.id),
  lastRunAt: integer('last_run_at'),
  nextRunAt: integer('next_run_at'),
  runCount: integer('run_count').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Command Logs
// ---------------------------------------------------------------------------
export const commandLogs = sqliteTable('command_logs', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  command: text('command').notNull(),
  exitCode: integer('exit_code'),
  durationMs: integer('duration_ms').default(0),
  output: text('output'),
  createdAt: integer('created_at').notNull(),
});
