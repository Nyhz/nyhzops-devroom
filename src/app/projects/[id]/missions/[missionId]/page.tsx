import { notFound } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getMission } from '@/actions/mission';
import { getDatabase } from '@/lib/db/index';
import { missionLogs } from '@/lib/db/schema';
import { TacBadge } from '@/components/ui/tac-badge';
import { Markdown } from '@/components/ui/markdown';
import { MissionComms } from '@/components/mission/mission-comms';

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

  const db = getDatabase();
  const logRows = db
    .select()
    .from(missionLogs)
    .where(eq(missionLogs.missionId, missionId))
    .orderBy(missionLogs.timestamp)
    .all();

  const status = mission.status ?? 'standby';

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
        <div className="font-data text-sm leading-relaxed">
          <Markdown content={mission.briefing} />
        </div>
      </div>

      {/* Live Comms + Tokens + Debrief + Actions */}
      <MissionComms
        missionId={missionId}
        initialLogs={logRows}
        initialStatus={status}
        initialDebrief={mission.debrief ?? null}
        initialTokens={{
          input: mission.costInput ?? 0,
          output: mission.costOutput ?? 0,
          cacheHit: mission.costCacheHit ?? 0,
          duration: mission.durationMs ?? 0,
        }}
        battlefieldId={id}
        initialSessionId={mission.sessionId || null}
        initialWorktreeBranch={mission.worktreeBranch || null}
      />
    </div>
  );
}
