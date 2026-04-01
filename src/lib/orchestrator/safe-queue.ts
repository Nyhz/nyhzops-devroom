import { escalate } from '@/lib/overseer/escalation';

/**
 * Safe wrapper around globalThis.orchestrator?.onMissionQueued().
 * Catches any errors, logs them, and fires a critical escalation.
 * If orchestrator is undefined, returns silently — not an error condition.
 */
export function safeQueueMission(missionId: string): void {
  if (!globalThis.orchestrator) return;

  try {
    globalThis.orchestrator.onMissionQueued(missionId);
  } catch (err) {
    console.error(`[safeQueueMission] Failed to queue mission ${missionId}:`, err);
    escalate({
      level: 'critical',
      title: 'Orchestrator Queue Failure',
      detail: `Mission ${missionId} could not be queued: ${err instanceof Error ? err.message : String(err)}`,
      entityType: 'mission',
      entityId: missionId,
    }).catch(() => {});
  }
}
