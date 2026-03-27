import Link from 'next/link';
import { count, eq, inArray, desc } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields, missions, assets } from '@/lib/db/schema';
import { TacCard } from '@/components/ui/tac-card';
import { TacBadge } from '@/components/ui/tac-badge';
import { TacButton } from '@/components/ui/tac-button';
import { StatsBar } from '@/components/dashboard/stats-bar';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { formatRelativeTime } from '@/lib/utils';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { BootGate } from '@/components/warroom/boot-gate';
import type { Battlefield } from '@/types';

export default function ProjectsPage() {
  const db = getDatabase();
  const allBattlefields = db.select().from(battlefields).all() as Battlefield[];

  // Global stats
  const totalInCombatResult = db.select({ value: count() }).from(missions)
    .where(inArray(missions.status, ['in_combat', 'deploying', 'reviewing'])).all();
  const totalAccomplishedResult = db.select({ value: count() }).from(missions)
    .where(eq(missions.status, 'accomplished')).all();
  const totalCompromisedResult = db.select({ value: count() }).from(missions)
    .where(eq(missions.status, 'compromised')).all();
  const totalStandbyResult = db.select({ value: count() }).from(missions)
    .where(eq(missions.status, 'standby')).all();

  const totalInCombat = totalInCombatResult[0]?.value ?? 0;
  const totalAccomplished = totalAccomplishedResult[0]?.value ?? 0;
  const totalCompromised = totalCompromisedResult[0]?.value ?? 0;
  const totalStandby = totalStandbyResult[0]?.value ?? 0;

  // Cache hit calculation
  const tokenSums = db.select({
    totalCacheHit: missions.costCacheHit,
    totalInput: missions.costInput,
  }).from(missions).all();

  let totalCacheHit = 0;
  let totalInput = 0;
  for (const row of tokenSums) {
    totalCacheHit += row.totalCacheHit ?? 0;
    totalInput += row.totalInput ?? 0;
  }
  const totalInputContext = totalInput + totalCacheHit;
  const cacheHitPercent = totalInputContext > 0
    ? `${Math.round((totalCacheHit / totalInputContext) * 100)}%`
    : '—';

  // Recent missions
  const recentMissions = db.select({
    id: missions.id,
    title: missions.title,
    status: missions.status,
    createdAt: missions.createdAt,
    battlefieldId: missions.battlefieldId,
    battlefieldCodename: battlefields.codename,
    assetCodename: assets.codename,
  }).from(missions)
    .leftJoin(battlefields, eq(missions.battlefieldId, battlefields.id))
    .leftJoin(assets, eq(missions.assetId, assets.id))
    .orderBy(desc(missions.createdAt))
    .limit(10).all();

  if (allBattlefields.length === 0) {
    return (
      <BootGate battlefieldCount={0} inCombatCount={0}>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-dr-amber font-tactical text-sm tracking-wider mb-2">
              NO BATTLEFIELDS DEPLOYED
            </div>
            <div className="text-dr-dim font-tactical text-xs mb-4">
              Create one to begin operations.
            </div>
            <Link href="/battlefields/new">
              <TacButton size="sm">+ NEW BATTLEFIELD</TacButton>
            </Link>
          </div>
        </div>
      </BootGate>
    );
  }

  return (
    <BootGate battlefieldCount={allBattlefields.length} inCombatCount={totalInCombat}>
    <PageWrapper className="space-y-8">
      {/* Global Stats */}
      <div>
        <div className="text-dr-amber font-tactical text-sm tracking-widest uppercase mb-3">
          HQ // GLOBAL OPERATIONS STATUS
        </div>
        <StatsBar
          inCombat={totalInCombat}
          accomplished={totalAccomplished}
          compromised={totalCompromised}
          standby={totalStandby}
          cacheHitPercent={cacheHitPercent}
        />
      </div>

      {/* Battlefield Grid */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <div className="text-dr-amber font-tactical text-sm tracking-widest uppercase">
            BATTLEFIELDS // SELECT THEATER OF OPERATIONS
          </div>
          <Link href="/battlefields/new">
            <TacButton size="sm">+ NEW BATTLEFIELD</TacButton>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {allBattlefields.map((bf) => {
            const statusColor = bf.status === 'active'
              ? 'green'
              : bf.status === 'initializing'
                ? 'blue'
                : undefined;

            return (
              <Link key={bf.id} href={`/battlefields/${bf.id}`}>
                <TacCard
                  status={statusColor as 'green' | 'amber' | 'red' | 'blue' | undefined}
                  className="hover:border-dr-amber transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="text-dr-amber font-tactical text-base tracking-wider uppercase">
                      {bf.codename}
                    </div>
                    <TacBadge status={bf.status ?? 'initializing'} />
                  </div>
                  <div className="text-dr-text font-tactical text-xs mb-1">
                    {bf.name}
                  </div>
                  {bf.description && (
                    <div className="text-dr-muted font-tactical text-xs line-clamp-2">
                      {bf.description}
                    </div>
                  )}
                </TacCard>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Bottom: Activity Feed + Recent Missions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Activity Feed */}
        <ActivityFeed />

        {/* Right: Recent Missions */}
        <div>
          <div className="text-dr-amber font-tactical text-sm tracking-widest uppercase mb-3">
            RECENT MISSIONS
          </div>
          <div className="bg-dr-surface border border-dr-border">
            {recentMissions.length === 0 ? (
              <div className="p-4 text-center text-dr-dim font-tactical text-xs">
                No missions deployed yet.
              </div>
            ) : (
              <div className="divide-y divide-dr-border">
                {recentMissions.map((m) => (
                  <Link
                    key={m.id}
                    href={`/battlefields/${m.battlefieldId}/missions/${m.id}`}
                    className="block px-4 py-3 hover:bg-dr-elevated transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-dr-text font-tactical text-xs truncate">
                          {m.title}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {m.battlefieldCodename && (
                            <span className="text-dr-dim font-tactical text-[10px] uppercase">
                              {m.battlefieldCodename}
                            </span>
                          )}
                          {m.assetCodename && (
                            <span className="text-dr-muted font-tactical text-[10px] uppercase">
                              {m.assetCodename}
                            </span>
                          )}
                          <span className="text-dr-dim font-tactical text-[10px]">
                            {formatRelativeTime(m.createdAt)}
                          </span>
                        </div>
                      </div>
                      <TacBadge status={m.status ?? 'standby'} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageWrapper>
    </BootGate>
  );
}
