'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMissionComms } from '@/hooks/use-mission-comms';
import { Terminal } from '@/components/ui/terminal';
import { MissionActions } from '@/components/mission/mission-actions';
import { DebriefPanel } from '@/components/mission/debrief-panel';
import type { MissionLog, MissionStatus } from '@/types';
import type { LogActor } from '@/components/ui/terminal';
import type { LiveMissionLog } from '@/hooks/use-mission-comms';
import type { Debrief } from '@/control/debrief/schema';
import type { Comm } from '@/lib/db/schema';

interface MissionCommsProps {
  missionId: string;
  initialLogs: MissionLog[];
  initialStatus: MissionStatus;
  initialDebrief: string | null;
  initialStructuredDebrief: Debrief | null;
  initialTokens: {
    input: number;
    output: number;
    cacheHit: number;
    duration: number;
  };
  battlefieldId: string;
  initialSessionId: string | null;
  campaignId?: string | null;
  briefing?: string;
  compromiseReason?: string | null;
  escalationQuestion?: string | null;
  isSynthesized: boolean;
  initialComms: Comm[];
}

const TERMINAL_STATUSES: MissionStatus[] = ['accomplished', 'compromised', 'abandoned'];
const PRE_DEPLOY_STATUSES: MissionStatus[] = ['standby', 'queued'];

/** Known actor names that map to styled labels in the Terminal. */
const KNOWN_ACTORS = new Set<LogActor>(['CONTROL', 'OPERATIVE', 'OVERSEER', 'COMMANDER']);

export function MissionComms({
  missionId,
  initialLogs,
  initialStatus,
  initialDebrief,
  initialStructuredDebrief,
  battlefieldId,
  initialSessionId,
  campaignId,
  briefing,
  compromiseReason,
  escalationQuestion,
  isSynthesized,
  initialComms,
}: MissionCommsProps) {
  const router = useRouter();
  const { logs, status, debrief, compromiseReason: liveCompromiseReason } = useMissionComms(
    missionId,
    initialLogs,
    initialStatus,
  );
  const hasRefreshed = useRef(false);

  const liveStatus = status ?? initialStatus;
  const liveDebrief = debrief ?? initialDebrief;

  // Refresh server data when mission reaches terminal state
  useEffect(() => {
    if (
      liveStatus &&
      TERMINAL_STATUSES.includes(liveStatus) &&
      !hasRefreshed.current
    ) {
      hasRefreshed.current = true;
      router.refresh();
    }
  }, [liveStatus, router]);

  // Build terminal logs — prefer structured comms table if available, else fall back to missionLogs
  const isPreDeploy = PRE_DEPLOY_STATUSES.includes(liveStatus);
  const terminalLogs = isPreDeploy
    ? [
        {
          timestamp: 0,
          type: 'sitrep' as const,
          content:
            'Awaiting deployment. Comms will appear here when the mission is in combat.',
        },
      ]
    : [
        ...buildTerminalLogs(logs, liveDebrief, liveStatus, initialComms),
        ...(TERMINAL_STATUSES.includes(liveStatus) && liveDebrief
          ? [
              {
                timestamp: 0,
                type: 'sitrep' as const,
                content: 'Debrief submitted. See report below.',
              },
            ]
          : []),
      ];

  const liveCompromise = liveCompromiseReason ?? compromiseReason;

  return (
    <div className="space-y-6">
      {/* Comms terminal */}
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
            COMMS
          </h2>
          <div className="h-px bg-dr-border" />
        </div>
        <Terminal logs={terminalLogs} />
      </div>

      {/* Debrief panel */}
      <DebriefPanel
        debrief={initialStructuredDebrief}
        debriefText={liveDebrief}
        isSynthesized={isSynthesized}
        isCompromised={liveStatus === 'compromised'}
      />

      {/* Mission Actions */}
      <MissionActions
        missionId={missionId}
        status={liveStatus}
        battlefieldId={battlefieldId}
        sessionId={initialSessionId}
        campaignId={campaignId}
        briefing={briefing}
        compromiseReason={liveCompromise}
        escalationQuestion={escalationQuestion}
      />
    </div>
  );
}

/**
 * Build terminal log entries from either the new comms table or legacy missionLogs.
 * Prefers comms table (with actor labels) if present; falls back to missionLogs.
 */
function buildTerminalLogs(
  logs: LiveMissionLog[],
  liveDebrief: string | null,
  liveStatus: MissionStatus,
  initialComms: Comm[],
): Array<{ timestamp: number; type: 'comms' | 'sitrep' | 'alert'; content: string; actor?: LogActor }> {
  const isTerminal = TERMINAL_STATUSES.includes(liveStatus);

  // If we have comms from the new table, use those with actor field for styled labels,
  // then append any live events received via socket after page load.
  if (initialComms.length > 0) {
    const staticEntries = initialComms.map((comm) => {
      const actor = KNOWN_ACTORS.has(comm.actor as LogActor)
        ? (comm.actor as LogActor)
        : undefined;
      const levelType: 'comms' | 'sitrep' | 'alert' =
        comm.level === 'error' ? 'alert' : comm.level === 'warn' ? 'sitrep' : 'comms';
      return {
        timestamp: comm.createdAt,
        type: levelType,
        content: comm.message,
        actor,
      };
    });
    const liveEntries = logs.map((log) => ({
      timestamp: log.timestamp,
      type: (log.type as 'comms' | 'sitrep' | 'alert') ?? 'comms',
      content: log.content,
      actor: log.actor && KNOWN_ACTORS.has(log.actor as LogActor)
        ? (log.actor as LogActor)
        : undefined,
    }));
    return [...staticEntries, ...liveEntries];
  }

  // Fall back to legacy missionLogs (no actor field)
  return logs
    .filter((log) => {
      // Hide the raw debrief text from comms — it's shown formatted below
      if (isTerminal && liveDebrief && log.type === 'comms' && liveDebrief.startsWith(log.content.slice(0, 100))) {
        return false;
      }
      return true;
    })
    .map((log) => ({
      timestamp: log.timestamp,
      type: (log.type as 'comms' | 'sitrep' | 'alert') ?? 'comms',
      content: log.content,
    }));
}
