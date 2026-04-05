// ---------------------------------------------------------------------------
// Status union types
// ---------------------------------------------------------------------------
export type BattlefieldStatus = 'initializing' | 'active' | 'archived';
export type MissionStatus = 'standby' | 'queued' | 'deploying' | 'in_combat' | 'reviewing' | 'approved' | 'merging' | 'accomplished' | 'compromised' | 'abandoned';
export type CompromiseReason = 'timeout' | 'merge-failed' | 'review-failed' | 'execution-failed' | 'escalated' | 'no-commits-produced' | 'verification-mutated-code';
export type CampaignStatus = 'draft' | 'planning' | 'active' | 'paused' | 'accomplished' | 'compromised' | 'abandoned';
export type PhaseStatus = 'standby' | 'active' | 'secured' | 'compromised';
export type AssetStatus = 'active' | 'offline';
export type AssetEffort = 'low' | 'medium' | 'high' | 'max';
export type MissionType = 'direct_action' | 'verification' | 'bootstrap' | 'conflict_resolution' | 'phase_debrief';
export type MissionPriority = 'low' | 'routine' | 'high' | 'critical';
export type WorktreeMode = 'none' | 'phase' | 'mission';
export type LogType = 'comms' | 'sitrep' | 'alert';
export type ScheduleType = 'mission' | 'campaign';

// ---------------------------------------------------------------------------
// Scaffold status
// ---------------------------------------------------------------------------
export type ScaffoldStatus = 'running' | 'complete' | 'failed';
