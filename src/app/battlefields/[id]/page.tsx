import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { battlefields, missions, assets } from '@/lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { DeployMission } from '@/components/dashboard/deploy-mission';
import { StatsBar } from '@/components/dashboard/stats-bar';
import { MissionList } from '@/components/dashboard/mission-list';
import { ScaffoldOutput } from '@/components/battlefield/scaffold-output';
import { ScaffoldRetry } from '@/components/battlefield/scaffold-retry';
import { BootstrapReview } from '@/components/battlefield/bootstrap-review';
import { BootstrapComms } from '@/components/battlefield/bootstrap-comms';
import { BootstrapError } from '@/components/battlefield/bootstrap-error';
import { readBootstrapFile } from '@/actions/battlefield';
import type { Battlefield } from '@/types';

export default async function BattlefieldOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
      <div className="p-6">
        <ScaffoldOutput battlefieldId={id} />
      </div>
    );
  }

  // 2. Scaffold failed
  if (battlefield.scaffoldStatus === 'failed') {
    return (
      <div className="p-6">
        <ScaffoldRetry battlefieldId={id} />
      </div>
    );
  }

  // 3. Bootstrap (initializing status)
  if (battlefield.status === 'initializing') {
    const bootstrapMission = battlefield.bootstrapMissionId
      ? db.select().from(missions).where(eq(missions.id, battlefield.bootstrapMissionId)).get()
      : null;

    if (bootstrapMission?.status === 'accomplished') {
      const claudeMd = await readBootstrapFile(id, 'CLAUDE.md');
      const specMd = await readBootstrapFile(id, 'SPEC.md');
      return (
        <div className="p-6">
          <BootstrapReview
            battlefieldId={id}
            codename={battlefield.codename || ''}
            initialBriefing={battlefield.initialBriefing || ''}
            initialClaudeMd={claudeMd}
            initialSpecMd={specMd}
          />
        </div>
      );
    }

    if (bootstrapMission?.status === 'compromised') {
      return (
        <div className="p-6">
          <BootstrapError
            battlefieldId={id}
            codename={battlefield.codename || ''}
            debrief={bootstrapMission.debrief?.slice(0, 200) || ''}
            initialBriefing={battlefield.initialBriefing || ''}
          />
        </div>
      );
    }

    if (bootstrapMission) {
      return (
        <BootstrapComms
          battlefieldId={id}
          missionId={bootstrapMission.id}
          codename={battlefield.codename || ''}
        />
      );
    }

    // No bootstrap mission — waiting state
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-dr-amber text-xl font-tactical tracking-wider mb-2">
            {battlefield.codename} — AWAITING BOOTSTRAP
          </div>
          <div className="text-dr-dim text-sm">No active bootstrap mission found.</div>
        </div>
      </div>
    );
  }

  // 4. Archived
  if (battlefield.status === 'archived') {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-dr-dim text-xl font-tactical tracking-wider mb-2">
            {battlefield.codename} — ARCHIVED
          </div>
          <div className="text-dr-dim text-sm">This battlefield has been archived.</div>
        </div>
      </div>
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
    .orderBy(
      sql`CASE ${missions.status} WHEN 'in_combat' THEN 0 WHEN 'deploying' THEN 1 WHEN 'queued' THEN 2 WHEN 'standby' THEN 3 WHEN 'accomplished' THEN 4 WHEN 'compromised' THEN 5 WHEN 'abandoned' THEN 6 END`,
      desc(missions.createdAt)
    )
    .all();

  // Stats computation
  const inCombatCount = missionRows.filter(m => m.status === 'in_combat' || m.status === 'deploying').length;
  const accomplishedCount = missionRows.filter(m => m.status === 'accomplished').length;
  const compromisedCount = missionRows.filter(m => m.status === 'compromised').length;
  const standbyCount = missionRows.filter(m => m.status === 'standby' || m.status === 'queued').length;

  // Cache hit calculation
  const totalInput = missionRows.reduce((sum, m) => sum + (m.costInput || 0), 0);
  const totalCacheHit = missionRows.reduce((sum, m) => sum + (m.costCacheHit || 0), 0);
  const cacheHitPercent = totalInput > 0 ? `${Math.round((totalCacheHit / totalInput) * 100)}%` : '—';

  // Cost summary for battlefield
  const totalOutput = missionRows.reduce((sum, m) => sum + (m.costOutput || 0), 0);
  const totalTokensAll = totalInput + totalOutput + totalCacheHit;
  // Approximate cost: Input $3/1M, Output $15/1M, Cache $0.30/1M
  const totalCostUsd = (totalInput * 3 + totalOutput * 15 + totalCacheHit * 0.3) / 1_000_000;
  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <div className="text-dr-dim font-tactical text-xs tracking-wider mb-1">
          Battlefields // {battlefield.name}
        </div>
        <h1 className="text-dr-amber font-tactical text-xl tracking-widest uppercase">
          {battlefield.codename}
        </h1>
        {battlefield.description && (
          <div className="text-dr-muted font-tactical text-xs mt-1">
            {battlefield.description}
          </div>
        )}
      </div>

      {/* Deploy Mission */}
      <DeployMission battlefieldId={id} assets={assetList} />

      {/* Stats bar */}
      <StatsBar
        inCombat={inCombatCount}
        accomplished={accomplishedCount}
        compromised={compromisedCount}
        standby={standbyCount}
        cacheHitPercent={cacheHitPercent}
      />

      {/* Cost summary */}
      {totalTokensAll > 0 && (
        <div className="text-dr-dim text-xs font-tactical">
          Total: {formatTokens(totalTokensAll)} tokens | ${totalCostUsd.toFixed(2)} USD | {cacheHitPercent} cache hit
        </div>
      )}

      {/* Missions section */}
      <MissionList missions={missionRows} battlefieldId={id} />
    </div>
  );
}
