import type { InferSelectModel } from 'drizzle-orm';
import type {
  battlefields,
  missions,
  campaigns,
  phases,
  assets,
  missionLogs,
  scheduledTasks,
  commandLogs,
  dossiers,
  overseerLogs,
  notifications,
  briefingSessions,
  briefingMessages,
  intelNotes,
  followUpSuggestions,
  testRuns,
} from '../lib/db/schema';

// ---------------------------------------------------------------------------
// Status union types
// ---------------------------------------------------------------------------
export type BattlefieldStatus = 'initializing' | 'active' | 'archived';
export type MissionStatus = 'standby' | 'queued' | 'deploying' | 'in_combat' | 'reviewing' | 'approved' | 'merging' | 'accomplished' | 'compromised' | 'abandoned';
export type CompromiseReason = 'timeout' | 'merge-failed' | 'review-failed' | 'execution-failed' | 'escalated';
export type CampaignStatus = 'draft' | 'planning' | 'active' | 'paused' | 'accomplished' | 'compromised' | 'abandoned';
export type PhaseStatus = 'standby' | 'active' | 'secured' | 'compromised';
export type AssetStatus = 'active' | 'offline';
export type AssetEffort = 'low' | 'medium' | 'high' | 'max';
export type MissionType = 'standard' | 'bootstrap' | 'conflict_resolution' | 'phase_debrief';
export type MissionPriority = 'low' | 'normal' | 'high' | 'critical';
export type WorktreeMode = 'none' | 'phase' | 'mission';
export type LogType = 'log' | 'status' | 'error';
export type ScheduleType = 'mission' | 'campaign';

// ---------------------------------------------------------------------------
// Row types inferred from Drizzle schema
// ---------------------------------------------------------------------------
export type Battlefield = InferSelectModel<typeof battlefields>;
export type Mission = InferSelectModel<typeof missions>;
export type Campaign = InferSelectModel<typeof campaigns>;
export type Phase = InferSelectModel<typeof phases>;
export type Asset = InferSelectModel<typeof assets>;
export type MissionLog = InferSelectModel<typeof missionLogs>;
export type ScheduledTask = InferSelectModel<typeof scheduledTasks>;
export type CommandLog = InferSelectModel<typeof commandLogs>;
export type Dossier = InferSelectModel<typeof dossiers>;
export type OverseerLog = InferSelectModel<typeof overseerLogs>;
export type Notification = InferSelectModel<typeof notifications>;
export type BriefingSession = InferSelectModel<typeof briefingSessions>;
export type BriefingMessage = InferSelectModel<typeof briefingMessages>;
export type IntelNote = InferSelectModel<typeof intelNotes>;
export type IntelNoteColumn = 'backlog' | 'planned';
export type FollowUpSuggestion = InferSelectModel<typeof followUpSuggestions>;
export type FollowUpSuggestionStatus = 'pending' | 'added' | 'dismissed';
export type TestRunRow = InferSelectModel<typeof testRuns>;

export interface IntelNoteWithMission extends IntelNote {
  missionStatus: MissionStatus | null;
  missionAssetCodename: string | null;
  missionCreatedAt: number | null;
}

export interface BoardColumn {
  key: string;
  label: string;
  color: string;         // tailwind color token
  acceptsDrop: boolean;  // only backlog + planned accept drops
}

export type NotificationLevel = 'info' | 'warning' | 'critical';
export type NotificationEntityType = 'mission' | 'campaign' | 'phase';
export type OverseerConfidence = 'high' | 'medium' | 'low';

export interface OverseerReview {
  verdict: 'approve' | 'retry' | 'escalate';
  concerns: string[];
  reasoning: string;
}

export interface DossierVariable {
  key: string;
  label: string;
  description: string;
  placeholder: string;
}

// ---------------------------------------------------------------------------
// Asset skills & MCP types
// ---------------------------------------------------------------------------
export interface SkillOverrides {
  added?: string[];
  removed?: string[];
}

export interface DiscoveredSkill {
  id: string;
  name: string;
  pluginName: string;
  description: string;
  pluginDir: string;
}

export interface DiscoveredMcp {
  id: string;
  name: string;
  command: string;
  args: string[];
  source: string;
}

// ---------------------------------------------------------------------------
// Scaffold status
// ---------------------------------------------------------------------------
export type ScaffoldStatus = 'running' | 'complete' | 'failed';

// ---------------------------------------------------------------------------
// Input types for Server Actions
// ---------------------------------------------------------------------------
export interface CreateBattlefieldInput {
  name: string;
  codename: string;
  description?: string;
  initialBriefing?: string;
  scaffoldCommand?: string;
  defaultBranch?: string;
  repoPath?: string;
  skipBootstrap?: boolean;
  claudeMdPath?: string;   // when skipping bootstrap
  specMdPath?: string;     // when skipping bootstrap
}

export interface UpdateBattlefieldInput {
  name?: string;
  codename?: string;
  description?: string;
  initialBriefing?: string;
  devServerCommand?: string;
  autoStartDevServer?: boolean;
  defaultBranch?: string;
}

export interface CreateMissionInput {
  battlefieldId: string;
  briefing: string;
  title?: string;
  assetId?: string;
  priority?: MissionPriority;
}

export interface ListMissionsOptions {
  search?: string;
  status?: MissionStatus;
}

// ---------------------------------------------------------------------------
// Enriched types for UI
// ---------------------------------------------------------------------------
export interface BattlefieldWithCounts extends Battlefield {
  missionCount: number;
  campaignCount: number;
  activeMissionCount: number;
}

export interface MissionWithDetails extends Mission {
  assetCodename: string | null;
  assetSpecialty: string | null;
  battlefieldCodename: string;
  logCount: number;
}

// ---------------------------------------------------------------------------
// Command runner types
// ---------------------------------------------------------------------------
export interface RunCommandOptions {
  command: string;
  cwd: string;
  socketRoom?: string;
  battlefieldId?: string;
  abortSignal?: AbortSignal;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// === Phase B2a: Orchestrator + Execution Types ===

// Stream parser result (final message from Claude Code)
export interface StreamResult {
  sessionId: string;
  result: string;
  isError: boolean;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  totalCostUsd: number;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
}

// Rate limit info from stream
export interface RateLimitInfo {
  status: string;
  resetsAt: number;
  rateLimitType: string;
}

// Per-turn token usage
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// Live token data for Socket.IO
export interface LiveTokenData {
  missionId: string;
  input: number;
  output: number;
  cacheHit: number;
  cacheCreation: number;
  costUsd: number;
}

// Merge result from worktree merger
export interface MergeResult {
  success: boolean;
  conflictResolved: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Merge result metadata
// ---------------------------------------------------------------------------
export type MergeResultType = 'clean' | 'conflict_resolved' | 'failed';

// ---------------------------------------------------------------------------
// Field Check types
// ---------------------------------------------------------------------------
export type WorktreeState = 'active' | 'stale' | 'orphaned';

export interface WorktreeEntry {
  path: string;
  branch: string;
  linkedMission: { id: string; codename: string; status: MissionStatus } | null;
  age: number;
  diskUsage: number;
  state: WorktreeState;
}

export interface BranchStats {
  total: number;
  merged: number;
  unmerged: number;
  active: number;
}

export type BranchProblem = 'merged' | 'stale' | 'diverged';

export interface ProblemBranch {
  name: string;
  problem: BranchProblem;
  lastCommitAge: number;
  ahead?: number;
  behind?: number;
}

export interface QMLogEntry {
  missionId: string;
  missionCodename: string;
  sourceBranch: string;
  targetBranch: string;
  result: MergeResultType;
  conflictFiles: string[];
  resolutionSummary: string | null;
  timestamp: number;
}

export interface RepoVitals {
  repoSize: number;
  totalCommits: number;
  lastCommit: { message: string; timestamp: number } | null;
  worktreeDisk: number;
  mainBranch: string;
  isDirty: boolean;
}

// ---------------------------------------------------------------------------
// Telemetry types
// ---------------------------------------------------------------------------
export interface ProcessEntry {
  missionId: string;
  missionCodename: string;
  asset: string;
  pid: number;
  startedAt: number;
  status: MissionStatus;
  memoryRss: number;
  lastOutputAt: number;
}

export interface ResourceMetrics {
  agentSlots: { active: number; max: number };
  worktreeDisk: number;
  tempDisk: number;
  dbSize: number;
  socketConnections: number;
}

export type FailureType = 'timeout' | 'auth_failure' | 'cli_error' | 'stall_killed' | 'killed' | 'unknown';

export interface ExitEntry {
  missionId: string;
  missionCodename: string;
  exitCode: number | null;
  duration: number;
  failureType: FailureType | null;
  timestamp: number;
}

export interface ServiceHealthStatus {
  scheduler: {
    status: 'running' | 'stalled';
    lastTick: number | null;
    nextFire: number | null;
    missedRuns: number;
  };
  overseer: {
    pendingReviews: number;
    avgReviewTime: number | null;
    lastReview: number | null;
  };
  quartermaster: {
    pendingMerges: number;
    lastMerge: number | null;
  };
  stallDetection: {
    count24h: number;
    lastStall: {
      missionCodename: string;
      timestamp: number;
      overseerDecision: string;
    } | null;
  };
}

// === Phase C1: Campaign Planning Types ===

export interface PlanJSON {
  summary: string;
  phases: PlanPhase[];
}

export interface PlanPhase {
  name: string;
  objective: string;
  missions: PlanMission[];
}

export interface PlanMission {
  title: string;
  briefing: string;
  assetCodename: string;
  priority: MissionPriority;
  dependsOn?: string[];
}

export interface CampaignWithPlan extends Campaign {
  phases: Array<Phase & {
    missions: Array<Mission & { assetCodename: string | null }>;
  }>;
}

// ---------------------------------------------------------------------------
// Git Dashboard types
// ---------------------------------------------------------------------------
export interface FileEntry {
  path: string;
  status: string;
}

export interface CommitEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
  refs: string;
}

export interface BranchEntry {
  name: string;
  current: boolean;
}

export interface GitStatusResult {
  staged: FileEntry[];
  modified: FileEntry[];
  untracked: FileEntry[];
}

export interface GitLogResult {
  commits: CommitEntry[];
}

export interface GitBranchesResult {
  current: string;
  local: BranchEntry[];
}

// ---------------------------------------------------------------------------
// System monitoring
// ---------------------------------------------------------------------------
export interface SystemMetrics {
  cores: number[];
  ram: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number };
  uptime: number;
  assets: { active: number; max: number };
}

// ---------------------------------------------------------------------------
// Environment Variable Manager
// ---------------------------------------------------------------------------
export interface EnvFileInfo {
  filename: string;
  inGitignore: boolean;
  varCount: number;
}

export interface EnvVariable {
  key: string;
  value: string;
  comment?: string;
  lineNumber: number;
}

// ---------------------------------------------------------------------------
// Dependency Manager
// ---------------------------------------------------------------------------
export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export interface DepEntry {
  name: string;
  version: string;
  isDev: boolean;
}

export interface DepsResult {
  packageManager: PackageManager;
  deps: DepEntry[];
  devDeps: DepEntry[];
}

export interface OutdatedDep {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  isDev: boolean;
}

export interface AuditVulnerability {
  name: string;
  severity: string;
  title: string;
  url?: string;
}

export interface AuditResult {
  vulnerabilities: AuditVulnerability[];
  summary: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
  };
}

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------
export type TestFramework = 'vitest' | 'jest' | 'playwright' | 'mocha';

export type TestRunStatus = 'running' | 'passed' | 'failed' | 'error';

export interface TestRun {
  id: string;
  battlefieldId: string;
  framework: TestFramework;
  command: string;
  pattern?: string;
  status: TestRunStatus;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  coveragePercent?: number;
  results?: TestSuiteResult[];
  createdAt: number;
}

export interface TestSuiteResult {
  name: string;
  file: string;
  tests: TestCaseResult[];
}

export interface TestCaseResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error?: {
    message: string;
    expected?: string;
    actual?: string;
    stack?: string;
  };
}
