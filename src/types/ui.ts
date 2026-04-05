import type { Battlefield, Mission } from './models';

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
