import type { MissionPriority, MissionStatus } from './status';

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
