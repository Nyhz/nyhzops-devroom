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
