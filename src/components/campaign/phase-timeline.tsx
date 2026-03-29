import Link from 'next/link';
import { formatDuration, formatTokens } from '@/lib/utils';
import { TacBadge, getStatusColor } from '@/components/ui/tac-badge';
import { TacCard } from '@/components/ui/tac-card';
import { Markdown } from '@/components/ui/markdown';
import { CampaignMissionCard } from '@/components/campaign/mission-card';

interface PhaseTimelineProps {
  phases: Array<{
    id: string;
    phaseNumber: number;
    name: string;
    objective: string | null;
    status: string | null;
    debrief: string | null;
    totalTokens: number | null;
    durationMs: number | null;
    missions: Array<{
      id: string;
      title: string | null;
      status: string | null;
      assetCodename: string | null;
      priority: string | null;
      durationMs: number | null;
      costInput: number | null;
      costOutput: number | null;
    }>;
  }>;
  battlefieldId?: string;
}


export function PhaseTimeline({ phases, battlefieldId }: PhaseTimelineProps) {
  if (phases.length === 0) {
    return (
      <div className="text-dr-muted font-tactical text-sm py-8 text-center">
        No phases in this campaign
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {phases.map((phase) => {
        const statusColor = phase.status ? getStatusColor(phase.status) : 'dim';
        const hasMetrics = phase.durationMs != null || phase.totalTokens != null;

        return (
          <TacCard
            key={phase.id}
            status={statusColor}
            className="p-0"
          >
            {/* Phase header */}
            <div className="bg-dr-elevated px-4 py-2 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-tactical text-xs text-dr-muted shrink-0">
                  PHASE {phase.phaseNumber}
                </span>
                <span className="font-tactical text-sm text-dr-amber truncate">
                  {phase.name}
                </span>
              </div>
              {phase.status && (
                <TacBadge status={phase.status} className="shrink-0" />
              )}
            </div>

            {/* Phase content */}
            <div className="p-4">
              {/* Objective */}
              {phase.objective && (
                <p className="font-data text-xs text-dr-muted mb-3">
                  {phase.objective}
                </p>
              )}

              {/* Metrics row */}
              {hasMetrics && (
                <div className="flex items-center gap-4 mb-3 font-data text-xs text-dr-muted">
                  {phase.durationMs != null && (
                    <span>{formatDuration(phase.durationMs)}</span>
                  )}
                  {phase.totalTokens != null && phase.totalTokens > 0 && (
                    <span>{formatTokens(phase.totalTokens)} tokens</span>
                  )}
                </div>
              )}

              {/* Mission cards */}
              {phase.missions.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {phase.missions.map((mission) => {
                    const card = (
                      <CampaignMissionCard
                        key={mission.id}
                        title={mission.title ?? 'Untitled Mission'}
                        assetCodename={mission.assetCodename}
                        status={mission.status}
                        priority={mission.priority}
                        durationMs={mission.durationMs}
                        costInput={mission.costInput}
                        costOutput={mission.costOutput}
                      />
                    );
                    if (battlefieldId) {
                      return (
                        <Link
                          key={mission.id}
                          href={`/battlefields/${battlefieldId}/missions/${mission.id}`}
                          className="hover:opacity-80 transition-opacity"
                        >
                          {card}
                        </Link>
                      );
                    }
                    return card;
                  })}
                </div>
              ) : (
                <p className="font-tactical text-xs text-dr-muted">
                  No missions in this phase
                </p>
              )}

              {/* Collapsible debrief */}
              {phase.debrief && (
                <details className="mt-4">
                  <summary className="font-tactical text-xs text-dr-muted cursor-pointer hover:text-dr-text select-none">
                    DEBRIEF
                  </summary>
                  <div className="mt-2 p-3 bg-dr-elevated border border-dr-border">
                    <Markdown content={phase.debrief} className="text-sm" />
                  </div>
                </details>
              )}
            </div>
          </TacCard>
        );
      })}
    </div>
  );
}
