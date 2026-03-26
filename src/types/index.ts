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
} from '../lib/db/schema';

// ---------------------------------------------------------------------------
// Status union types
// ---------------------------------------------------------------------------
export type BattlefieldStatus = 'initializing' | 'active' | 'archived';
export type MissionStatus = 'standby' | 'queued' | 'deploying' | 'in_combat' | 'accomplished' | 'compromised' | 'abandoned';
export type CampaignStatus = 'draft' | 'planning' | 'active' | 'paused' | 'accomplished' | 'compromised';
export type PhaseStatus = 'standby' | 'active' | 'secured' | 'compromised';
export type AssetStatus = 'active' | 'offline';
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

export interface DossierVariable {
  key: string;
  label: string;
  description: string;
  placeholder: string;
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
