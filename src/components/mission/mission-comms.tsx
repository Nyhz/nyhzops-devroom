'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMissionComms } from '@/hooks/use-mission-comms';
import { Terminal } from '@/components/ui/terminal';
import { MissionActions } from '@/components/mission/mission-actions';
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
  initialWorktreeBranch: string | null;
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
  initialWorktreeBranch,
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
          timestamp: Date.now(),
          type: 'status' as const,
          content:
            'Awaiting deployment. Comms will appear here when the mission is in combat.',
        },
      ]
    : [
        ...logs.map((log) => ({
          timestamp: log.timestamp,
          type: (log.type as 'log' | 'status' | 'error') ?? 'log',
          content: log.content,
        })),
        ...(isReviewing
          ? [
              {
                timestamp: Date.now(),
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
      <div className="bg-dr-surface border border-dr-border p-4">
        <div className="grid grid-cols-5 gap-4 text-xs font-tactical">
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
            className={`font-data text-sm leading-relaxed border p-4 ${
              liveStatus === 'compromised'
                ? 'bg-dr-red/5 border-dr-red/30'
                : 'bg-dr-surface border-dr-border'
            }`}
          >
            {liveDebrief.split('\n').filter(Boolean).map((line, i) => (
              <p key={i} className="text-dr-text mb-2 last:mb-0">{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* Mission Actions */}
      <MissionActions
        missionId={missionId}
        status={liveStatus}
        battlefieldId={battlefieldId}
        sessionId={initialSessionId}
        worktreeBranch={initialWorktreeBranch}
        campaignId={campaignId}
        briefing={briefing}
      />
    </div>
  );
}
