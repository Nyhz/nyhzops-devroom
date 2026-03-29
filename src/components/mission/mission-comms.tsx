'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMissionComms } from '@/hooks/use-mission-comms';
import { Terminal } from '@/components/ui/terminal';
import { MissionActions } from '@/components/mission/mission-actions';
import { Markdown } from '@/components/ui/markdown';
import { TacCard } from '@/components/ui/tac-card';
import { formatDuration } from '@/lib/utils';
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
  const displayOutput = tokens?.output ?? initialTokens.output;
  const displayCacheHit = tokens?.cacheHit ?? initialTokens.cacheHit;
  const displayDuration = initialTokens.duration; // Duration comes from DB on completion
  const displayCostUsd = tokens?.costUsd ?? null;

  const totalInputContext = displayInput + displayCacheHit;
  const cachePercent =
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
                content: 'Agent work complete. Captain reviewing debrief...',
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

      {/* Token stats */}
      <TacCard className="p-4">
        <div className="grid grid-cols-2 gap-4 text-xs font-tactical md:grid-cols-5">
          <div>
            <div className="text-dr-muted tracking-wider mb-1">INPUT</div>
            <div className="text-dr-text">
              {displayInput > 0 ? displayInput.toLocaleString() : '\u2014'}
            </div>
          </div>
          <div>
            <div className="text-dr-muted tracking-wider mb-1">OUTPUT</div>
            <div className="text-dr-text">
              {displayOutput > 0 ? displayOutput.toLocaleString() : '\u2014'}
            </div>
          </div>
          <div>
            <div className="text-dr-muted tracking-wider mb-1">CACHE</div>
            <div className="text-dr-text">
              {displayCacheHit > 0
                ? `${displayCacheHit.toLocaleString()} (${cachePercent}%)`
                : '\u2014'}
            </div>
          </div>
          <div>
            <div className="text-dr-muted tracking-wider mb-1">DURATION</div>
            <div className="text-dr-text">
              {displayDuration > 0 ? formatDuration(displayDuration) : '\u2014'}
            </div>
          </div>
          <div>
            <div className="text-dr-muted tracking-wider mb-1">COST</div>
            <div className="text-dr-text">
              {displayCostUsd != null && displayCostUsd > 0
                ? `$${displayCostUsd.toFixed(4)}`
                : '\u2014'}
            </div>
          </div>
        </div>
      </TacCard>

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
            className={`border p-4 ${
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
      />
    </div>
  );
}
