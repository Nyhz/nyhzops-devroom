import type { MissionStatus } from './status';

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
