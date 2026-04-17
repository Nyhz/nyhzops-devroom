import { notFound } from 'next/navigation';
import { eq, desc } from 'drizzle-orm';
import { getMission } from '@/actions/mission';
import { getOverseerLogs } from '@/actions/overseer';
import { getSuggestions } from '@/actions/follow-up';
import { getDatabase } from '@/lib/db/index';
import { missionLogs, missionAttempts, comms, missions } from '@/lib/db/schema';
import { LiveStatusBadge } from '@/components/mission/live-status-badge';
import { MissionTypeBadge } from '@/components/mission/mission-type-badge';
import { MissionComms } from '@/components/mission/mission-comms';
import { FollowUpCardsLive } from '@/components/follow-up/follow-up-cards-live';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { TacCard } from '@/components/ui/tac-card';
import { Markdown } from '@/components/ui/markdown';
import { formatRelativeTime } from '@/lib/utils';
import { DebriefSchema } from '@/control/debrief/schema';
import type { Debrief } from '@/control/debrief/schema';
import type { MissionStatus } from '@/types';

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

  // Legacy mission logs (used as fallback if no comms table entries)
  const logRows = db
    .select()
    .from(missionLogs)
    .where(eq(missionLogs.missionId, missionId))
    .orderBy(missionLogs.timestamp)
    .all();

  // Fetch debriefStructured directly (getMission select doesn't include it)
  const missionRaw = db
    .select({ debriefStructured: missions.debriefStructured })
    .from(missions)
    .where(eq(missions.id, missionId))
    .get();
  const rawDebriefStructured = missionRaw?.debriefStructured ?? null;

  // New structured comms stream (actor-labelled)
  const commRows = db
    .select()
    .from(comms)
    .where(eq(comms.missionId, missionId))
    .orderBy(comms.createdAt)
    .limit(200)
    .all();

  // Latest mission attempt — for debriefSynthesized flag
  const latestAttempt = db
    .select()
    .from(missionAttempts)
    .where(eq(missionAttempts.missionId, missionId))
    .orderBy(desc(missionAttempts.attemptNumber))
    .get() ?? null;

  const isSynthesized = latestAttempt?.debriefSynthesized === 1;

  // Parse structured debrief if present (debriefStructured stores raw JSON, not <DEBRIEF> tagged text)
  let structuredDebrief: Debrief | null = null;
  if (rawDebriefStructured) {
    try {
      const raw = JSON.parse(rawDebriefStructured);
      const validation = DebriefSchema.safeParse(raw);
      if (validation.success) {
        structuredDebrief = validation.data;
      }
    } catch {
      // malformed JSON — fall through to plain debrief text
    }
  }

  // Extract escalation question from open_questions in structured debrief
  // when compromiseReason === 'escalated'
  let escalationQuestion: string | null = null;
  if (mission.compromiseReason === 'escalated' && structuredDebrief) {
    const highSeverityQ = structuredDebrief.open_questions.find(
      (q) => q.severity === 'high',
    );
    escalationQuestion =
      highSeverityQ?.description ??
      structuredDebrief.open_questions[0]?.description ??
      null;
  }

  const overseerLogEntries = await getOverseerLogs({ missionId });
  const suggestions = await getSuggestions({ missionId });

  const status = (mission.status ?? 'standby') as MissionStatus;
  const isTerminal = status === 'accomplished' || status === 'compromised' || status === 'abandoned';
  const missionType = mission.type === 'recon' ? 'recon' : 'combat';

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
        {mission.worktreeBranch && (
          <span className="text-dr-muted">
            Worktree:{' '}
            <span className="text-dr-text font-mono">{mission.worktreeBranch}</span>
          </span>
        )}
      </div>

      {/* Recon banner — no-merge notice */}
      {missionType === 'recon' && (
        <div className="border-l-2 border-dr-teal bg-dr-teal/5 px-3 py-2 flex items-start gap-2">
          <span aria-hidden="true" className="text-dr-teal text-sm mt-0.5">◈</span>
          <div className="flex-1">
            <div className="font-tactical text-xs text-dr-teal uppercase tracking-wider">
              RECON MISSION
            </div>
            <div className="font-data text-xs text-dr-muted mt-0.5">
              Read-only reconnaissance. This mission must not modify code — no merge will be performed on completion.
            </div>
          </div>
        </div>
      )}

      {/* Briefing — collapsed by default */}
      <div className="space-y-3">
        <details>
          <summary className="cursor-pointer list-none flex items-center gap-2 group">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-dr-dim group-open:hidden" aria-hidden="true">▶</span>
                <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
                  BRIEFING
                </h2>
              </div>
              <div className="h-px bg-dr-border" />
            </div>
          </summary>
          <TacCard className="p-2.5 sm:p-4 mt-3">
            <Markdown content={mission.briefing} className="text-sm" />
          </TacCard>
        </details>
      </div>

      {/* Telemetry row */}
      {(mission.iterations || mission.durationMs || mission.costInput) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs font-data">
          {mission.iterations != null && mission.iterations > 0 && (
            <div className="bg-dr-surface border border-dr-border px-2 py-1.5">
              <div className="text-dr-dim uppercase tracking-wider text-[10px]">ITERATIONS</div>
              <div className="text-dr-text mt-0.5">{mission.iterations}</div>
            </div>
          )}
          {mission.durationMs != null && mission.durationMs > 0 && (
            <div className="bg-dr-surface border border-dr-border px-2 py-1.5">
              <div className="text-dr-dim uppercase tracking-wider text-[10px]">DURATION</div>
              <div className="text-dr-text mt-0.5">{Math.round(mission.durationMs / 1000)}s</div>
            </div>
          )}
          {mission.costInput != null && mission.costInput > 0 && (
            <div className="bg-dr-surface border border-dr-border px-2 py-1.5">
              <div className="text-dr-dim uppercase tracking-wider text-[10px]">INPUT TOKENS</div>
              <div className="text-dr-text mt-0.5">{mission.costInput.toLocaleString()}</div>
            </div>
          )}
          {mission.costOutput != null && mission.costOutput > 0 && (
            <div className="bg-dr-surface border border-dr-border px-2 py-1.5">
              <div className="text-dr-dim uppercase tracking-wider text-[10px]">OUTPUT TOKENS</div>
              <div className="text-dr-text mt-0.5">{mission.costOutput.toLocaleString()}</div>
            </div>
          )}
          {mission.costCacheHit != null && mission.costCacheHit > 0 && (
            <div className="bg-dr-surface border border-dr-border px-2 py-1.5">
              <div className="text-dr-dim uppercase tracking-wider text-[10px]">CACHE HIT</div>
              <div className="text-dr-text mt-0.5">{mission.costCacheHit.toLocaleString()}</div>
            </div>
          )}
        </div>
      )}

      {/* Live Comms + Debrief + Actions */}
      <MissionComms
        missionId={missionId}
        initialLogs={logRows}
        initialStatus={status}
        initialDebrief={mission.debrief ?? null}
        initialStructuredDebrief={structuredDebrief}
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
        compromiseReason={mission.compromiseReason}
        escalationQuestion={escalationQuestion}
        isSynthesized={isSynthesized}
        initialComms={commRows}
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
