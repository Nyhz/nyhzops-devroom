import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getMission } from '@/actions/mission';
import { TacBadge } from '@/components/ui/tac-badge';
import { Terminal } from '@/components/ui/terminal';
import { MissionActions } from '@/components/mission/mission-actions';
import { formatDuration } from '@/lib/utils';

export default async function MissionDetailPage({
  params,
}: {
  params: Promise<{ id: string; missionId: string }>;
}) {
  const { id, missionId } = await params;
  const mission = await getMission(missionId);

  if (!mission) {
    notFound();
  }

  const costInput = mission.costInput ?? 0;
  const costOutput = mission.costOutput ?? 0;
  const costCacheHit = mission.costCacheHit ?? 0;
  const durationMs = mission.durationMs ?? 0;
  const status = mission.status ?? 'standby';
  const totalTokens = costInput + costOutput;
  const cachePercent =
    totalTokens > 0
      ? Math.round((costCacheHit / totalTokens) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="text-xs font-tactical text-dr-dim tracking-wider">
          <Link
            href={`/projects/${id}`}
            className="hover:text-dr-muted transition-colors"
          >
            Battlefields // {mission.battlefieldCodename} // Missions
          </Link>
        </div>
        <h1 className="text-xl font-tactical text-dr-amber tracking-wider">
          MISSION: {mission.title}
        </h1>
        <div className="flex items-center gap-4 text-xs font-tactical">
          <TacBadge status={status} />
          <span className="text-dr-muted">
            Asset:{' '}
            <span className="text-dr-text">
              {mission.assetCodename ?? 'UNASSIGNED'}
            </span>
          </span>
          <span className="text-dr-muted">
            Priority:{' '}
            <span className="text-dr-text uppercase">{mission.priority}</span>
          </span>
        </div>
      </div>

      {/* Briefing */}
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
            BRIEFING
          </h2>
          <div className="h-px bg-dr-border" />
        </div>
        <div className="whitespace-pre-wrap font-data text-dr-text text-sm leading-relaxed">
          {mission.briefing}
        </div>
      </div>

      {/* Comms */}
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
            COMMS
          </h2>
          <div className="h-px bg-dr-border" />
        </div>
        <Terminal
          logs={[
            {
              timestamp: Date.now(),
              type: 'status' as const,
              content:
                'Awaiting deployment. Comms will appear here when the mission is in combat.',
            },
          ]}
        />
      </div>

      {/* Tokens */}
      <div className="bg-dr-surface border border-dr-border p-4">
        <div className="grid grid-cols-4 gap-4 text-xs font-tactical">
          <div>
            <div className="text-dr-dim tracking-wider mb-1">INPUT</div>
            <div className="text-dr-text">
              {costInput > 0 ? costInput.toLocaleString() : '—'}
            </div>
          </div>
          <div>
            <div className="text-dr-dim tracking-wider mb-1">OUTPUT</div>
            <div className="text-dr-text">
              {costOutput > 0
                ? costOutput.toLocaleString()
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-dr-dim tracking-wider mb-1">CACHE</div>
            <div className="text-dr-text">
              {costCacheHit > 0
                ? `${costCacheHit.toLocaleString()} (${cachePercent}%)`
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-dr-dim tracking-wider mb-1">DURATION</div>
            <div className="text-dr-text">
              {durationMs > 0
                ? formatDuration(durationMs)
                : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Debrief (if available) */}
      {mission.debrief && (
        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
              DEBRIEF
            </h2>
            <div className="h-px bg-dr-border" />
          </div>
          <div className="whitespace-pre-wrap font-data text-dr-text text-sm leading-relaxed bg-dr-surface border border-dr-border p-4">
            {mission.debrief}
          </div>
        </div>
      )}

      {/* Actions */}
      <MissionActions
        missionId={missionId}
        status={status}
        battlefieldId={id}
      />
    </div>
  );
}
