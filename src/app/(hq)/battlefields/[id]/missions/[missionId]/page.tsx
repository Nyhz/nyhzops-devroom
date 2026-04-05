import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getMission } from '@/actions/mission';
import { getOverseerLogs } from '@/actions/overseer';
import { getSuggestions } from '@/actions/follow-up';
import { getDatabase } from '@/lib/db/index';
import { missionLogs } from '@/lib/db/schema';
import { LiveStatusBadge } from '@/components/mission/live-status-badge';
import { MissionTypeBadge } from '@/components/mission/mission-type-badge';
import { MissionComms } from '@/components/mission/mission-comms';
import { FollowUpCardsLive } from '@/components/follow-up/follow-up-cards-live';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { TacCard } from '@/components/ui/tac-card';
import { Markdown } from '@/components/ui/markdown';
import { formatRelativeTime } from '@/lib/utils';

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

  const overseerLogEntries = await getOverseerLogs({ missionId });
  const suggestions = await getSuggestions({ missionId });

  const status = mission.status ?? 'standby';
  const isTerminal = status === 'accomplished' || status === 'compromised';
  const missionType = mission.type === 'verification' ? 'verification' : 'direct_action';

  return (
    <PageWrapper
      breadcrumb={[mission.battlefieldCodename ?? 'Battlefield', 'MISSIONS']}
      title={`MISSION: ${mission.title}`}
    >
      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-2 md:gap-4 text-xs font-tactical">
        <LiveStatusBadge missionId={missionId} initialStatus={status} />
        <MissionTypeBadge type={missionType} />
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

      {/* Verification banner — no-merge notice */}
      {missionType === 'verification' && (
        <div className="border-l-2 border-dr-teal bg-dr-teal/5 px-3 py-2 flex items-start gap-2">
          <span aria-hidden="true" className="text-dr-teal text-sm mt-0.5">◈</span>
          <div className="flex-1">
            <div className="font-tactical text-xs text-dr-teal uppercase tracking-wider">
              VERIFICATION MISSION
            </div>
            <div className="font-data text-xs text-dr-muted mt-0.5">
              Read-only reconnaissance. This mission must not modify code — no merge will be performed on completion.
            </div>
          </div>
        </div>
      )}

      {/* Briefing */}
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
            BRIEFING
          </h2>
          <div className="h-px bg-dr-border" />
        </div>
        <TacCard className="p-2.5 sm:p-4">
          <Markdown content={mission.briefing} className="text-sm" />
        </TacCard>
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
        campaignId={mission.campaignId}
        briefing={mission.briefing}
        worktreeBranch={mission.worktreeBranch}
        compromiseReason={mission.compromiseReason}
      />

      {/* Follow-Up Suggestions */}
      {isTerminal && (
        <FollowUpCardsLive
          missionId={missionId}
          initialSuggestions={suggestions}
        />
      )}

      {/* Overseer's Log */}
      {overseerLogEntries.length > 0 && (
        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
              OVERSEER&apos;S LOG ({overseerLogEntries.length})
            </h2>
            <div className="h-px bg-dr-border" />
          </div>
          <div className="space-y-2">
            {overseerLogEntries.map((log) => (
              <TacCard
                key={log.id}
                status={log.escalated ? 'red' : undefined}
                className="px-3 py-2.5 space-y-1.5"
              >
                <div className="flex flex-wrap items-center gap-2 md:gap-3 text-xs font-tactical">
                  <span className="text-dr-dim">
                    {formatRelativeTime(log.timestamp)}
                  </span>
                  <span
                    className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                      log.confidence === 'high'
                        ? 'text-dr-green border-dr-green'
                        : log.confidence === 'medium'
                          ? 'text-dr-amber border-dr-amber'
                          : 'text-dr-red border-dr-red'
                    }`}
                  >
                    {log.confidence}
                  </span>
                  {log.escalated ? (
                    <span className="text-dr-red uppercase tracking-wider text-[10px]">
                      ESCALATED
                    </span>
                  ) : null}
                </div>
                <div className="bg-dr-bg border border-dr-border px-2 py-1.5">
                  <p className="text-xs font-data text-dr-muted whitespace-pre-wrap">
                    {log.question.length > 300
                      ? log.question.slice(0, 300) + '...'
                      : log.question}
                  </p>
                </div>
                <div className="text-dr-green">
                  <Markdown content={log.answer} className="text-sm" />
                </div>
                <p className="text-xs font-data text-dr-dim italic">
                  {log.reasoning}
                </p>
              </TacCard>
            ))}
          </div>
        </div>
      )}
    </PageWrapper>
  );
}
