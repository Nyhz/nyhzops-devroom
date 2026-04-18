import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { battlefields, missions, assets } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { DeployMission } from '@/components/dashboard/deploy-mission';
import { StatsBar } from '@/components/dashboard/stats-bar';
import { MissionList } from '@/components/dashboard/mission-list';
import { ScaffoldOutput } from '@/components/battlefield/scaffold-output';
import { ScaffoldRetry } from '@/components/battlefield/scaffold-retry';
import { BootstrapReview } from '@/components/battlefield/bootstrap-review';
import { BootstrapInProgress } from '@/components/battlefield/bootstrap-in-progress';
import { readBootstrapFile } from '@/actions/battlefield';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { formatTokens } from '@/lib/utils';
import type { Battlefield } from '@/types';

export default async function BattlefieldOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { id } = await params;
  const { briefing: prefillBriefing, noteId } = await searchParams;
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get() as Battlefield | undefined;

  if (!battlefield) {
    notFound();
  }

  // 1. Scaffold running
  if (battlefield.scaffoldStatus === 'running') {
    return (
      <PageWrapper>
        <ScaffoldOutput battlefieldId={id} />
      </PageWrapper>
    );
  }

  // 2. Scaffold failed
  if (battlefield.scaffoldStatus === 'failed') {
    return (
      <PageWrapper>
        <ScaffoldRetry battlefieldId={id} />
      </PageWrapper>
    );
  }

  // 3. Bootstrap (initializing status)
  // INTEL writes CLAUDE.md + SPEC.md directly; presence of both files is the
  // signal that bootstrap produced reviewable output. Until then, show the
  // in-progress view which auto-refreshes.
  if (battlefield.status === 'initializing') {
    const claudeMd = await readBootstrapFile(id, 'CLAUDE.md');
    const specMd = await readBootstrapFile(id, 'SPEC.md');

    if (claudeMd && specMd) {
      return (
        <PageWrapper>
          <BootstrapReview
            battlefieldId={id}
            codename={battlefield.codename || ''}
            initialBriefing={battlefield.initialBriefing || ''}
            initialClaudeMd={claudeMd}
            initialSpecMd={specMd}
          />
        </PageWrapper>
      );
    }

    return (
      <PageWrapper>
        <BootstrapInProgress
          codename={battlefield.codename || ''}
          claudeMdExists={Boolean(claudeMd)}
          specMdExists={Boolean(specMd)}
        />
      </PageWrapper>
    );
  }

  // 4. Archived
  if (battlefield.status === 'archived') {
    return (
      <PageWrapper className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-dr-dim text-xl font-tactical tracking-wider mb-2">
            {battlefield.codename} — ARCHIVED
          </div>
          <div className="text-dr-dim text-sm">This battlefield has been archived.</div>
        </div>
      </PageWrapper>
    );
  }

  // 5. Active — normal battlefield overview
  const assetList = db
    .select({ id: assets.id, codename: assets.codename, status: assets.status })
    .from(assets)
    .where(eq(assets.status, 'active'))
    .all()
    .map((a) => ({ ...a, status: a.status ?? 'active' }));

  // Query missions with asset join
  const missionRows = db.select({
    id: missions.id,
    title: missions.title,
    status: missions.status,
    priority: missions.priority,
    iterations: missions.iterations,
    costInput: missions.costInput,
    costOutput: missions.costOutput,
    costCacheHit: missions.costCacheHit,
    createdAt: missions.createdAt,
    assetCodename: assets.codename,
  }).from(missions)
    .leftJoin(assets, eq(missions.assetId, assets.id))
    .where(eq(missions.battlefieldId, id))
    .orderBy(desc(missions.createdAt))
    .all();

  // Stats computation
  const inCombatCount = missionRows.filter(m => m.status === 'in_combat' || m.status === 'deploying').length;
  const accomplishedCount = missionRows.filter(m => m.status === 'accomplished').length;
  const compromisedCount = missionRows.filter(m => m.status === 'compromised').length;
  const standbyCount = missionRows.filter(m => m.status === 'standby' || m.status === 'queued').length;
  const abandonedCount = missionRows.filter(m => m.status === 'abandoned').length;

  // Cache hit calculation: cache / (cache + uncached input) = % of input context served from cache
  const totalInput = missionRows.reduce((sum, m) => sum + (m.costInput || 0), 0);
  const totalCacheHit = missionRows.reduce((sum, m) => sum + (m.costCacheHit || 0), 0);
  const totalInputContext = totalInput + totalCacheHit;
  const cacheHitPercent = totalInputContext > 0 ? `${Math.round((totalCacheHit / totalInputContext) * 100)}%` : '—';

  // Cost summary for battlefield
  const totalOutput = missionRows.reduce((sum, m) => sum + (m.costOutput || 0), 0);
  const totalTokensAll = totalInput + totalOutput + totalCacheHit;
  // Approximate cost: Input $3/1M, Output $15/1M, Cache $0.30/1M
  const totalCostUsd = (totalInput * 3 + totalOutput * 15 + totalCacheHit * 0.3) / 1_000_000;

  return (
    <PageWrapper breadcrumb={battlefield.codename} title="Missions">
      {battlefield.description && (
        <div className="text-dr-muted font-tactical text-xs -mt-4">
          {battlefield.description}
        </div>
      )}

      {/* Deploy Mission */}
      <DeployMission
        battlefieldId={id}
        assets={assetList}
        initialBriefing={prefillBriefing}
        noteId={noteId}
      />

      {/* Stats bar */}
      <StatsBar
        inCombat={inCombatCount}
        accomplished={accomplishedCount}
        compromised={compromisedCount}
        standby={standbyCount}
        abandoned={abandonedCount}
      />

      {/* Cost summary */}
      {totalTokensAll > 0 && (
        <div className="text-dr-dim text-xs font-tactical">
          Total: {formatTokens(totalTokensAll)} tokens | ${totalCostUsd.toFixed(2)} USD | {cacheHitPercent} cache hit
        </div>
      )}

      {/* Missions section */}
      <MissionList missions={missionRows} battlefieldId={id} />
    </PageWrapper>
  );
}
