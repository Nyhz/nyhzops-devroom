import { getDatabase } from '@/lib/db/index';
import { battlefields, missions, campaigns, phases, assets, missionLogs } from '@/lib/db/schema';
import { eq, inArray, count, desc, sql, and } from 'drizzle-orm';
import { WarRoom } from '@/components/warroom/war-room';
import type { Mission, Campaign, Phase, Asset, Battlefield } from '@/types';

export const dynamic = 'force-dynamic';

export default function WarRoomPage() {
  const db = getDatabase();

  // ── Global Stats ──────────────────────────────────────────────
  const inCombatCount = db
    .select({ value: count() })
    .from(missions)
    .where(eq(missions.status, 'in_combat'))
    .get()?.value ?? 0;

  const accomplishedCount = db
    .select({ value: count() })
    .from(missions)
    .where(eq(missions.status, 'accomplished'))
    .get()?.value ?? 0;

  const compromisedCount = db
    .select({ value: count() })
    .from(missions)
    .where(eq(missions.status, 'compromised'))
    .get()?.value ?? 0;

  const standbyCount = db
    .select({ value: count() })
    .from(missions)
    .where(eq(missions.status, 'standby'))
    .get()?.value ?? 0;

  const queuedCount = db
    .select({ value: count() })
    .from(missions)
    .where(eq(missions.status, 'queued'))
    .get()?.value ?? 0;

  const totalBattlefields = db
    .select({ value: count() })
    .from(battlefields)
    .where(eq(battlefields.status, 'active'))
    .get()?.value ?? 0;

  // Cache hit rate
  const tokenTotals = db
    .select({
      totalInput: sql<number>`COALESCE(SUM(${missions.costInput}), 0)`,
      totalCacheHit: sql<number>`COALESCE(SUM(${missions.costCacheHit}), 0)`,
    })
    .from(missions)
    .get();

  const totalTokensForCache = (tokenTotals?.totalInput ?? 0) + (tokenTotals?.totalCacheHit ?? 0);
  const cacheHitPercent =
    totalTokensForCache > 0
      ? Math.round(((tokenTotals?.totalCacheHit ?? 0) / totalTokensForCache) * 100)
      : 0;

  // ── Active Missions (non-terminal) ────────────────────────────
  const activeStatuses = ['in_combat', 'deploying', 'queued', 'standby'];
  const rawActiveMissions = db
    .select({
      mission: missions,
      assetCodename: assets.codename,
      battlefieldCodename: battlefields.codename,
    })
    .from(missions)
    .leftJoin(assets, eq(missions.assetId, assets.id))
    .innerJoin(battlefields, eq(missions.battlefieldId, battlefields.id))
    .where(inArray(missions.status, activeStatuses))
    .orderBy(desc(missions.updatedAt))
    .limit(20)
    .all();

  // Get last comms line for in_combat missions
  const activeMissions = rawActiveMissions.map((row) => {
    let lastCommsLine: string | null = null;
    if (row.mission.status === 'in_combat') {
      const lastLog = db
        .select({ content: missionLogs.content })
        .from(missionLogs)
        .where(eq(missionLogs.missionId, row.mission.id))
        .orderBy(desc(missionLogs.timestamp))
        .limit(1)
        .get();
      if (lastLog) {
        lastCommsLine = lastLog.content.slice(0, 120);
      }
    }
    return {
      ...row.mission,
      assetCodename: row.assetCodename ?? null,
      battlefieldCodename: row.battlefieldCodename,
      lastCommsLine,
    };
  });

  // ── Active Campaigns ──────────────────────────────────────────
  const rawCampaigns = db
    .select({
      campaign: campaigns,
      battlefieldCodename: battlefields.codename,
    })
    .from(campaigns)
    .innerJoin(battlefields, eq(campaigns.battlefieldId, battlefields.id))
    .where(inArray(campaigns.status, ['active', 'planning']))
    .orderBy(desc(campaigns.updatedAt))
    .limit(10)
    .all();

  const activeCampaigns = rawCampaigns.map((row) => {
    const campaignPhases = db
      .select()
      .from(phases)
      .where(eq(phases.campaignId, row.campaign.id))
      .orderBy(phases.phaseNumber)
      .all() as Phase[];

    const phasesWithCounts = campaignPhases.map((phase) => {
      const missionCount = db
        .select({ value: count() })
        .from(missions)
        .where(eq(missions.phaseId, phase.id))
        .get()?.value ?? 0;
      return { ...phase, missionCount };
    });

    return {
      ...row.campaign,
      battlefieldCodename: row.battlefieldCodename,
      phases: phasesWithCounts,
    };
  });

  // ── Asset Deployment ──────────────────────────────────────────
  const allAssets = db.select().from(assets).where(eq(assets.status, 'active')).all() as Asset[];

  const assetDeployment = allAssets.map((asset) => {
    // Check if asset has an in_combat mission
    const combatMission = db
      .select({ title: missions.title })
      .from(missions)
      .where(and(eq(missions.assetId, asset.id), eq(missions.status, 'in_combat')))
      .limit(1)
      .get();

    if (combatMission) {
      return {
        ...asset,
        currentStatus: 'in_combat' as const,
        currentMissionTitle: combatMission.title,
      };
    }

    // Check if queued
    const queuedMission = db
      .select({ title: missions.title })
      .from(missions)
      .where(and(eq(missions.assetId, asset.id), eq(missions.status, 'queued')))
      .limit(1)
      .get();

    if (queuedMission) {
      return {
        ...asset,
        currentStatus: 'queued' as const,
        currentMissionTitle: queuedMission.title,
      };
    }

    return {
      ...asset,
      currentStatus: 'idle' as const,
      currentMissionTitle: null,
    };
  });

  // ── Battlefield Summaries ─────────────────────────────────────
  const allBattlefields = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.status, 'active'))
    .all() as Battlefield[];

  const battlefieldSummaries = allBattlefields.map((bf) => {
    const missionCount = db
      .select({ value: count() })
      .from(missions)
      .where(eq(missions.battlefieldId, bf.id))
      .get()?.value ?? 0;

    const activeCount = db
      .select({ value: count() })
      .from(missions)
      .where(
        and(
          eq(missions.battlefieldId, bf.id),
          inArray(missions.status, ['in_combat', 'deploying', 'queued']),
        )
      )
      .get()?.value ?? 0;

    return {
      id: bf.id,
      codename: bf.codename,
      missionCount,
      activeCount,
    };
  });

  return (
    <WarRoom
      stats={{
        inCombat: inCombatCount,
        accomplished: accomplishedCount,
        compromised: compromisedCount,
        standby: standbyCount,
        queued: queuedCount,
        totalBattlefields: totalBattlefields,
        cacheHitPercent,
      }}
      activeMissions={activeMissions}
      activeCampaigns={activeCampaigns}
      assetDeployment={assetDeployment}
      battlefieldSummaries={battlefieldSummaries}
    />
  );
}
