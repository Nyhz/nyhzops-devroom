'use client';

import { useRouter } from 'next/navigation';
import { cn, formatDuration, formatTokens } from '@/lib/utils';
import { TacBadge } from '@/components/ui/tac-badge';
import { InlineErrorPanel } from '@/components/ui/inline-error-panel';
import { MergeCountdown } from '@/components/mission/merge-countdown';

interface CampaignMissionCardProps {
  missionId?: string;
  title: string;
  assetCodename: string | null;
  status: string | null;
  priority: string | null;
  durationMs: number | null;
  costInput: number | null;
  costOutput: number | null;
  compromiseReason?: string | null;
  mergeRetryAt?: number | null;
  battlefieldId?: string | null;
  className?: string;
}

const priorityDotColor: Record<string, string> = {
  low: 'bg-dr-dim',
  normal: 'bg-dr-muted',
  high: 'bg-dr-amber',
  critical: 'bg-dr-red',
};

function getCompromiseTitle(reason: string | null): string {
  switch (reason) {
    case 'merge-failed': return 'MERGE FAILED';
    case 'review-failed': return 'OVERSEER REJECTED';
    case 'timeout': return 'MISSION TIMED OUT';
    case 'execution-failed': return 'PROCESS CRASHED';
    case 'escalated': return 'OVERSEER ESCALATION';
    default: return 'COMPROMISED';
  }
}

export function CampaignMissionCard({
  missionId,
  title,
  assetCodename,
  status,
  priority,
  durationMs,
  costInput,
  costOutput,
  compromiseReason,
  mergeRetryAt,
  battlefieldId,
  className,
}: CampaignMissionCardProps) {
  const router = useRouter();
  const normalizedPriority = (priority ?? 'normal').toLowerCase();
  const dotColor = priorityDotColor[normalizedPriority] ?? 'bg-dr-muted';
  const hasMetrics = durationMs != null || (costInput != null && costOutput != null);
  const normalizedStatus = status?.toLowerCase().replace(/\s+/g, '_') ?? null;
  const isCompromised = normalizedStatus === 'compromised';
  const isMerging = normalizedStatus === 'merging';

  return (
    <div
      className={cn(
        'bg-dr-elevated border border-dr-border p-3 min-w-[200px] w-full md:max-w-[280px] flex flex-col gap-1.5',
        className,
      )}
    >
      {/* Title row with priority dot */}
      <div className="flex items-start gap-2">
        <span
          className={cn('mt-1.5 h-3 w-3 shrink-0 rounded-full', dotColor)}
          title={`Priority: ${normalizedPriority}`}
        />
        <span className="font-tactical text-sm text-dr-text truncate">
          {title}
        </span>
      </div>

      {/* Asset codename */}
      {assetCodename && (
        <span className="font-tactical text-xs text-dr-muted tracking-wider pl-4">
          {assetCodename}
        </span>
      )}

      {/* Status badge */}
      {status && (
        <div className="pl-4">
          <TacBadge status={status} className="text-xs" />
        </div>
      )}

      {/* Merge countdown */}
      {isMerging && mergeRetryAt && (
        <div className="pl-4">
          <MergeCountdown retryAt={mergeRetryAt} />
        </div>
      )}

      {/* Error panel for compromised missions */}
      {isCompromised && compromiseReason && missionId && battlefieldId && (
        <div className="pl-4 mt-1">
          <InlineErrorPanel
            title={getCompromiseTitle(compromiseReason)}
            detail={compromiseReason.replace(/-/g, ' ')}
            actions={[
              {
                label: 'View Logs',
                variant: 'secondary',
                onClick: () => {
                  router.push(`/battlefields/${battlefieldId}/missions/${missionId}`);
                },
              },
            ]}
          />
        </div>
      )}

      {/* Duration + tokens */}
      {hasMetrics && (
        <div className="flex items-center gap-3 pl-4 font-data text-xs text-dr-muted">
          {durationMs != null && (
            <span>{formatDuration(durationMs)}</span>
          )}
          {costInput != null && costOutput != null && (
            <span>{formatTokens(costInput + costOutput)} tokens</span>
          )}
        </div>
      )}
    </div>
  );
}
