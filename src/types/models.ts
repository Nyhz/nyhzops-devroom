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
import type { MissionStatus } from './status';

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
export type IntelNoteColumn = 'tasked' | 'ops_ready';
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
export type OverseerDecisionType =
  | 'review-approve'
  | 'review-retry'
  | 'review-escalate'
  | 'phase-retry'
  | 'phase-skip'
  | 'phase-escalate'
  | 'stall-advice';

export interface OverseerReview {
  verdict: 'approve' | 'retry' | 'escalate';
  concerns: string[];
  reasoning: string;
  /** When true, this verdict is a fallback from a parser failure, not a real OVERSEER decision. */
  parseFailure?: boolean;
}

export interface DossierVariable {
  key: string;
  label: string;
  description: string;
  placeholder: string;
}
