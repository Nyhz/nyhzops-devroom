import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { battlefields, missions, assets } from '@/lib/db/schema';
import { eq, count, and } from 'drizzle-orm';
import { SearchInput } from '@/components/ui/search-input';
import { DeployMission } from '@/components/dashboard/deploy-mission';
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

  // Stat counts
  const countByStatus = (status: string) => {
    const result = db
      .select({ value: count() })
      .from(missions)
      .where(and(eq(missions.battlefieldId, id), eq(missions.status, status)))
      .all();
    return result[0]?.value ?? 0;
  };

  const inCombat = countByStatus('in_combat');
  const accomplished = countByStatus('accomplished');
  const compromised = countByStatus('compromised');
  const standby = countByStatus('standby');

  // Cache hit calculation
  const allMissions = db
    .select({
      costInput: missions.costInput,
      costCacheHit: missions.costCacheHit,
    })
    .from(missions)
    .where(eq(missions.battlefieldId, id))
    .all();

  let cacheHitPct = 0;
  const totalInput = allMissions.reduce((s, m) => s + (m.costInput ?? 0), 0);
  const totalCacheHit = allMissions.reduce((s, m) => s + (m.costCacheHit ?? 0), 0);
  if (totalInput + totalCacheHit > 0) {
    cacheHitPct = Math.round((totalCacheHit / (totalInput + totalCacheHit)) * 100);
  }

  const totalMissions = inCombat + accomplished + compromised + standby;

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
      <div className="flex gap-px">
        <div className="flex-1 bg-dr-surface border border-dr-border p-3 text-center">
          <div className="text-dr-amber font-tactical text-lg">{inCombat}</div>
          <div className="text-dr-dim font-tactical text-[10px] tracking-wider uppercase">
            IN COMBAT
          </div>
        </div>
        <div className="flex-1 bg-dr-surface border border-dr-border p-3 text-center">
          <div className="text-dr-green font-tactical text-lg">{accomplished}</div>
          <div className="text-dr-dim font-tactical text-[10px] tracking-wider uppercase">
            ACCOMPLISHED
          </div>
        </div>
        <div className="flex-1 bg-dr-surface border border-dr-border p-3 text-center">
          <div className="text-dr-red font-tactical text-lg">{compromised}</div>
          <div className="text-dr-dim font-tactical text-[10px] tracking-wider uppercase">
            COMPROMISED
          </div>
        </div>
        <div className="flex-1 bg-dr-surface border border-dr-border p-3 text-center">
          <div className="text-dr-dim font-tactical text-lg">{standby}</div>
          <div className="text-dr-dim font-tactical text-[10px] tracking-wider uppercase">
            STANDBY
          </div>
        </div>
        <div className="flex-1 bg-dr-surface border border-dr-border p-3 text-center">
          <div className="text-dr-green font-tactical text-lg">{cacheHitPct}%</div>
          <div className="text-dr-dim font-tactical text-[10px] tracking-wider uppercase">
            CACHE HIT
          </div>
        </div>
      </div>

      {/* Missions section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
            MISSIONS
          </div>
          <SearchInput placeholder="Search missions..." className="w-64" />
        </div>
        {totalMissions === 0 ? (
          <div className="bg-dr-surface border border-dr-border p-8 text-center">
            <div className="text-dr-dim font-tactical text-xs">
              No missions deployed yet. Deploy your first mission above.
            </div>
          </div>
        ) : (
          <div className="bg-dr-surface border border-dr-border p-4">
            <div className="text-dr-muted font-tactical text-xs">
              {totalMissions} mission{totalMissions !== 1 ? 's' : ''} on record.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
