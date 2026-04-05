import type { MissionPriority, MissionType } from './status';
import type { Campaign, Phase, Mission } from './models';

// ---------------------------------------------------------------------------
// Campaign Planning Types
// ---------------------------------------------------------------------------
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
  type?: MissionType;
  dependsOn?: string[];
}

export interface CampaignWithPlan extends Campaign {
  phases: Array<Phase & {
    missions: Array<Mission & { assetCodename: string | null }>;
  }>;
}
