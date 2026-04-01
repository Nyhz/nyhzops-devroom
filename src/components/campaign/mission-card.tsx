'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn, formatDuration, formatTokens } from '@/lib/utils';
import { TacBadge } from '@/components/ui/tac-badge';
import { InlineErrorPanel } from '@/components/ui/inline-error-panel';
import { MergeCountdown } from '@/components/mission/merge-countdown';
import { MissionSkillPanel } from '@/components/campaign/mission-skill-panel';

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
  // Skill override props — only used when campaign is in planning/draft status
  campaignStatus?: string | null;
  assetSkills?: string | null;
  assetMcpServers?: string | null;
  currentSkillOverrides?: { added?: string[]; removed?: string[] } | null;
  discoveredSkills?: Array<{ id: string; name: string; description: string; pluginName: string }>;
  discoveredMcps?: Array<{ id: string; name: string; source: string }>;
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
  campaignStatus,
  assetSkills,
  assetMcpServers,
  currentSkillOverrides,
  discoveredSkills,
  discoveredMcps,
}: CampaignMissionCardProps) {
  const router = useRouter();
  const normalizedPriority = (priority ?? 'normal').toLowerCase();
  const dotColor = priorityDotColor[normalizedPriority] ?? 'bg-dr-muted';
  const hasMetrics = durationMs != null || (costInput != null && costOutput != null);
  const normalizedStatus = status?.toLowerCase().replace(/\s+/g, '_') ?? null;
  const isCompromised = normalizedStatus === 'compromised';
  const isMerging = normalizedStatus === 'merging';

  const [skillPanelOpen, setSkillPanelOpen] = useState(false);

  const canOverride =
    missionId != null &&
    assetCodename != null &&
    (campaignStatus === 'planning' || campaignStatus === 'draft') &&
    discoveredSkills != null &&
    discoveredMcps != null;

  const hasOverrides =
    (currentSkillOverrides?.added?.length ?? 0) > 0 ||
    (currentSkillOverrides?.removed?.length ?? 0) > 0;

  return (
    <div
      className={cn(
        'relative bg-dr-elevated border border-dr-border p-3 min-w-[200px] w-full md:max-w-[280px] flex flex-col gap-1.5',
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

      {/* Asset codename — clickable when overrides are available */}
      {assetCodename && (
        <div className="pl-4">
          {canOverride ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSkillPanelOpen((prev) => !prev);
              }}
              className={cn(
                'font-tactical text-xs tracking-wider',
                'hover:text-dr-amber transition-colors cursor-pointer',
                hasOverrides ? 'text-dr-amber' : 'text-dr-muted',
              )}
              title="Configure skill overrides for this mission"
            >
              {assetCodename}
              {hasOverrides && (
                <span className="ml-1 text-dr-amber opacity-80">*</span>
              )}
            </button>
          ) : (
            <span className="font-tactical text-xs text-dr-muted tracking-wider">
              {assetCodename}
            </span>
          )}
        </div>
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

      {/* Skill override panel */}
      {canOverride && skillPanelOpen && missionId && assetCodename && (
        <MissionSkillPanel
          missionId={missionId}
          asset={{
            codename: assetCodename,
            skills: assetSkills ?? null,
            mcpServers: assetMcpServers ?? null,
          }}
          currentOverrides={currentSkillOverrides ?? null}
          discoveredSkills={discoveredSkills!}
          discoveredMcps={discoveredMcps!}
          onClose={() => setSkillPanelOpen(false)}
        />
      )}
    </div>
  );
}
