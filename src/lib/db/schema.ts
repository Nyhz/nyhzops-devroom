import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  gateManifest: text('gate_manifest'), // JSON: { build, test, lint, typecheck }
  needsGateManifest: integer('needs_gate_manifest').notNull().default(0),
  mainIsRed: integer('main_is_red').notNull().default(0),
  overrideMainRedGuard: integer('override_main_red_guard').notNull().default(0),
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
  type: text('type', { enum: ['combat', 'recon'] }).notNull().default('combat'),
  title: text('title').notNull(),
  briefing: text('briefing').notNull(),
  status: text('status').default('standby'),
  priority: text('priority').default('routine'),
  assetId: text('asset_id').references(() => assets.id),
  useWorktree: integer('use_worktree').default(0),
  worktreeBranch: text('worktree_branch'),
  dependsOn: text('depends_on'),
  sessionId: text('session_id'),
  debrief: text('debrief'),
  debriefStructured: text('debrief_structured'), // JSON
  iterations: integer('iterations').default(0),
  costInput: integer('cost_input').default(0),
  costOutput: integer('cost_output').default(0),
  costCacheHit: integer('cost_cache_hit').default(0),
  compromiseReason: text('compromise_reason'),
  nextAttemptAt: integer('next_attempt_at'),
  infrastructureRetryCount: integer('infrastructure_retry_count').notNull().default(0),
  reconViolatedReadonly: integer('recon_violated_readonly').notNull().default(0),
  currentSortieAttempts: integer('current_sortie_attempts').notNull().default(0),
  mergeResult: text('merge_result'),           // 'clean' | 'conflict_resolved' | 'failed' | null
  mergeConflictFiles: text('merge_conflict_files'), // JSON array of file paths
  mergeTimestamp: integer('merge_timestamp'),
  skillOverrides: text('skill_overrides'),
  durationMs: integer('duration_ms').default(0),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('idx_missions_status').on(table.status),
  index('idx_missions_battlefield').on(table.battlefieldId),
  index('idx_missions_bf_status').on(table.battlefieldId, table.status),
]);

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
  debrief: text('debrief'),
  stallReason: text('stall_reason'),
  stalledPhaseId: text('stalled_phase_id'),
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
  completingAt: integer('completing_at'),
  createdAt: integer('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// Briefing Sessions (STRATEGIST 1-on-1 chat for campaign planning)
// ---------------------------------------------------------------------------
export const briefingSessions = sqliteTable('briefing_sessions', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  sessionId: text('session_id'),
  assetId: text('asset_id').references(() => assets.id),
  status: text('status').default('open'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  uniqueIndex('briefing_sessions_campaign_id_unique').on(table.campaignId),
]);

export const briefingMessages = sqliteTable('briefing_messages', {
  id: text('id').primaryKey(),
  briefingId: text('briefing_id').notNull().references(() => briefingSessions.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  timestamp: integer('timestamp').notNull(),
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
  skills: text('skills'),
  mcpServers: text('mcp_servers'),
  maxTurns: integer('max_turns'),
  effort: text('effort'),
  isSystem: integer('is_system').default(0),
  memory: text('memory'),
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
  dossierId: text('dossier_id'),
  lastRunAt: integer('last_run_at'),
  nextRunAt: integer('next_run_at'),
  runCount: integer('run_count').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Dossiers (Mission briefing templates)
// ---------------------------------------------------------------------------
export const dossiers = sqliteTable('dossiers', {
  id: text('id').primaryKey(),
  codename: text('codename').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  briefingTemplate: text('briefing_template').notNull(),
  variables: text('variables'), // JSON array of { key, label, description, placeholder }
  assetCodename: text('asset_codename'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Overseer Logs (AI decision layer)
// ---------------------------------------------------------------------------
export const overseerLogs = sqliteTable('overseer_logs', {
  id: text('id').primaryKey(),
  missionId: text('mission_id').notNull().references(() => missions.id),
  campaignId: text('campaign_id').references(() => campaigns.id),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  reasoning: text('reasoning').notNull(),
  confidence: text('confidence').notNull(),  // 'high' | 'medium' | 'low'
  escalated: integer('escalated').default(0),
  decisionType: text('decision_type'),
  timestamp: integer('timestamp').notNull(),
}, (table) => [
  index('idx_overseer_logs_mission').on(table.missionId),
]);

// ---------------------------------------------------------------------------
// Notifications (Escalation + In-App)
// ---------------------------------------------------------------------------
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),           // 'info' | 'warning' | 'critical'
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  entityType: text('entity_type'),          // 'mission' | 'campaign' | 'phase'
  entityId: text('entity_id'),
  battlefieldId: text('battlefield_id'),
  read: integer('read').default(0),
  telegramSent: integer('telegram_sent').default(0),
  telegramMsgId: integer('telegram_msg_id'),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_notifications_read_created').on(table.read, table.createdAt),
]);

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

// ---------------------------------------------------------------------------
// General Sessions (standalone GENERAL chat)
// ---------------------------------------------------------------------------
export const generalSessions = sqliteTable('general_sessions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sessionId: text('session_id'),               // Claude Code resume session ID
  battlefieldId: text('battlefield_id').references(() => battlefields.id),
  status: text('status').default('active'),    // 'active' | 'closed'
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const generalMessages = sqliteTable('general_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => generalSessions.id),
  role: text('role').notNull(),                // 'commander' | 'general' | 'system'
  content: text('content').notNull(),
  timestamp: integer('timestamp').notNull(),
});

// ---------------------------------------------------------------------------
// Test Runs (Test runner history)
// ---------------------------------------------------------------------------
export const testRuns = sqliteTable('test_runs', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  framework: text('framework').notNull(),
  command: text('command').notNull(),
  pattern: text('pattern'),
  status: text('status').notNull().default('running'),
  totalTests: integer('total_tests').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  coveragePercent: integer('coverage_percent'),
  results: text('results'),
  rawOutput: text('raw_output'),
  createdAt: integer('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// Intel Notes (Board cards)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Follow-Up Suggestions (extracted from debriefs)
// ---------------------------------------------------------------------------
export const followUpSuggestions = sqliteTable('follow_up_suggestions', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  missionId: text('mission_id').references(() => missions.id),
  campaignId: text('campaign_id').references(() => campaigns.id),
  suggestion: text('suggestion').notNull(),
  status: text('status').notNull().default('pending'),  // 'pending' | 'added' | 'dismissed'
  intelNoteId: text('intel_note_id').references(() => intelNotes.id),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Intel Notes (Board cards)
// ---------------------------------------------------------------------------
export const intelNotes = sqliteTable('intel_notes', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  title: text('title').notNull(),
  description: text('description'),              // markdown, may contain base64 images
  column: text('column').default('tasked'),      // 'tasked' | 'ops_ready'
  position: integer('position').default(0),
  missionId: text('mission_id').references(() => missions.id),
  campaignId: text('campaign_id').references(() => campaigns.id),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Settings — global key/value configuration (single row per key)
// ---------------------------------------------------------------------------
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Mission Attempts (per-attempt lifecycle audit — CONTROL reliability layer)
// ---------------------------------------------------------------------------
export const missionAttempts = sqliteTable('mission_attempts', {
  id: text('id').primaryKey(),
  missionId: text('mission_id').notNull().references(() => missions.id),
  attemptNumber: integer('attempt_number').notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  endReason: text('end_reason', {
    enum: ['clean', 'timeout', 'silence-kill', 'infrastructure', 'rate-limit', 'auth', 'turn-limit', 'gate-failure', 'consult-error'],
  }),
  classification: text('classification'), // JSON
  gateResults: text('gate_results'), // JSON
  debriefSynthesized: integer('debrief_synthesized').notNull().default(0),
  autoCommitted: integer('auto_committed').notNull().default(0),
  tokensInput: integer('tokens_input').notNull().default(0),
  tokensOutput: integer('tokens_output').notNull().default(0),
  tokensCache: integer('tokens_cache').notNull().default(0),
  durationMs: integer('duration_ms'),
  sessionId: text('session_id'),
  targetHeadAtStart: text('target_head_at_start'),
}, (table) => [
  index('idx_mission_attempts_mission').on(table.missionId),
]);

export type MissionAttempt = typeof missionAttempts.$inferSelect;
export type NewMissionAttempt = typeof missionAttempts.$inferInsert;

// ---------------------------------------------------------------------------
// Comms (structured event stream — CONTROL reliability layer)
// ---------------------------------------------------------------------------
export const comms = sqliteTable('comms', {
  id: text('id').primaryKey(),
  missionId: text('mission_id'),
  campaignId: text('campaign_id'),
  battlefieldId: text('battlefield_id'),
  actor: text('actor').notNull(),
  message: text('message').notNull(),
  level: text('level', { enum: ['info', 'warn', 'error'] }).notNull().default('info'),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_comms_mission').on(table.missionId),
  index('idx_comms_campaign').on(table.campaignId),
  index('idx_comms_battlefield').on(table.battlefieldId),
]);

export type Comm = typeof comms.$inferSelect;
export type NewComm = typeof comms.$inferInsert;

// ---------------------------------------------------------------------------
// Managed Apps (OPS control panel)
// ---------------------------------------------------------------------------
export const managedApps = sqliteTable('managed_apps', {
  slug: text('slug').primaryKey(),
  displayName: text('display_name').notNull(),
  battlefieldId: text('battlefield_id').references(() => battlefields.id),
  launchdLabel: text('launchd_label').notNull(),
  ctlScriptPath: text('ctl_script_path').notNull(),
  logPath: text('log_path').notNull(),
  healthUrl: text('health_url'),
  orderIdx: integer('order_idx').notNull().default(0),
  isSelfControlled: integer('is_self_controlled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const managedAppMetrics = sqliteTable('managed_app_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  ts: integer('ts').notNull(),
  bucket: text('bucket', { enum: ['raw', '1m', '5m'] }).notNull(),
  rss: integer('rss'),
  cpu: real('cpu'),
  healthy: integer('healthy', { mode: 'boolean' }),
  httpCode: integer('http_code'),
  latencyMs: integer('latency_ms'),
}, (t) => [
  index('mam_slug_ts').on(t.slug, t.ts),
  index('mam_bucket_ts').on(t.bucket, t.ts),
]);
