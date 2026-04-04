'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMissionComms } from '@/hooks/use-mission-comms';
import { Terminal } from '@/components/ui/terminal';
import { MissionActions } from '@/components/mission/mission-actions';
import { Markdown } from '@/components/ui/markdown';
import type { MissionLog, MissionStatus } from '@/types';

interface MissionCommsProps {
  missionId: string;
  initialLogs: MissionLog[];
  initialStatus: string;
  initialDebrief: string | null;
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
  worktreeBranch?: string | null;
  compromiseReason?: string | null;
}

const TERMINAL_STATUSES: MissionStatus[] = ['accomplished', 'compromised', 'abandoned'];
const PRE_DEPLOY_STATUSES = ['standby', 'queued'];

export function MissionComms({
  missionId,
  initialLogs,
  initialStatus,
  initialDebrief,
  initialTokens,
  battlefieldId,
  initialSessionId,
  campaignId,
  briefing,
  worktreeBranch,
  compromiseReason,
}: MissionCommsProps) {
  const router = useRouter();
  const { logs, status, debrief, tokens } = useMissionComms(
    missionId,
    initialLogs,
    initialStatus,
  );
  const hasRefreshed = useRef(false);

  const liveStatus = status ?? (initialStatus as MissionStatus);
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

  // Token display values — prefer live data, fall back to initial
  const displayInput = tokens?.input ?? initialTokens.input;
  const _displayOutput = tokens?.output ?? initialTokens.output;
  const displayCacheHit = tokens?.cacheHit ?? initialTokens.cacheHit;
  const _displayDuration = initialTokens.duration; // Duration comes from DB on completion
  const _displayCostUsd = tokens?.costUsd ?? null;

  const totalInputContext = displayInput + displayCacheHit;
  const _cachePercent =
    totalInputContext > 0 ? Math.round((displayCacheHit / totalInputContext) * 100) : 0;

  // Build terminal logs
  const isPreDeploy = PRE_DEPLOY_STATUSES.includes(liveStatus);
  const isReviewing = liveStatus === 'reviewing';
  const terminalLogs = isPreDeploy
    ? [
        {
          timestamp: 0,
          type: 'status' as const,
          content:
            'Awaiting deployment. Comms will appear here when the mission is in combat.',
        },
      ]
    : [
        ...logs
          .filter((log) => {
            // Hide the raw debrief text from comms — it's shown formatted below
            // Only filter when mission is terminal (not while still running)
            const isTerminal = TERMINAL_STATUSES.includes(liveStatus);
            if (isTerminal && liveDebrief && log.type === 'log' && liveDebrief.startsWith(log.content.slice(0, 100))) {
              return false;
            }
            return true;
          })
          .map((log) => ({
            timestamp: log.timestamp,
            type: (log.type as 'log' | 'status' | 'error') ?? 'log',
            content: log.content,
          })),
        ...(TERMINAL_STATUSES.includes(liveStatus) && liveDebrief
          ? [
              {
                timestamp: 0,
                type: 'status' as const,
                content: 'Debrief submitted. See report below.',
              },
            ]
          : []),
        ...(isReviewing
          ? [
              {
                timestamp: 0,
                type: 'status' as const,
                content: 'Agent work complete. Overseer reviewing debrief...',
              },
            ]
          : []),
      ];

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

      {/* Debrief */}
      {liveDebrief && (
        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
              {liveStatus === 'compromised' ? 'SITUATION REPORT' : 'DEBRIEF'}
            </h2>
            <div className="h-px bg-dr-border" />
          </div>
          <div
            className={`border p-2.5 sm:p-4 ${
              liveStatus === 'compromised'
                ? 'bg-dr-red/5 border-dr-red/30'
                : 'bg-dr-surface border-dr-border'
            }`}
          >
            <Markdown content={liveDebrief} className="text-sm" />
          </div>
        </div>
      )}

      {/* Mission Actions */}
      <MissionActions
        missionId={missionId}
        status={liveStatus}
        battlefieldId={battlefieldId}
        sessionId={initialSessionId}
        campaignId={campaignId}
        briefing={briefing}
        worktreeBranch={worktreeBranch}
        debrief={liveDebrief}
        compromiseReason={compromiseReason}
      />
    </div>
  );
}
