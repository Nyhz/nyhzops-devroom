import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { battlefields, missions, assets } from '@/lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { DeployMission } from '@/components/dashboard/deploy-mission';
import { StatsBar } from '@/components/dashboard/stats-bar';
import { MissionList } from '@/components/dashboard/mission-list';
import { ScaffoldOutput } from '@/components/battlefield/scaffold-output';
import { ScaffoldRetry } from '@/components/battlefield/scaffold-retry';
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

      {/* Scaffold status */}
      {battlefield.scaffoldStatus === 'running' && (
        <ScaffoldOutput battlefieldId={id} />
      )}
      {battlefield.scaffoldStatus === 'failed' && (
        <ScaffoldRetry battlefieldId={id} />
      )}

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

      {/* Missions section */}
      <MissionList missions={missionRows} battlefieldId={id} />
    </div>
  );
}
