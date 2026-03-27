import { getDatabase } from '@/lib/db/index';
import { battlefields, missions, campaigns, phases, assets, captainLogs } from '@/lib/db/schema';
import { eq, desc, sql, inArray } from 'drizzle-orm';
import { config } from '@/lib/config';
import { Overwatch } from '@/components/overwatch/overwatch';
import type { Mission, Campaign, Phase, Asset, CaptainLog } from '@/types';

// ---------------------------------------------------------------------------
// Data types for OVERWATCH
// ---------------------------------------------------------------------------
export interface OverwatchMission {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  costInput: number | null;
  costOutput: number | null;
  costCacheHit: number | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  assetCodename: string | null;
  battlefieldCodename: string;
}

export interface OverwatchCampaign {
  id: string;
  name: string;
  status: string | null;
  battlefieldCodename: string;
  phases: Array<{
    id: string;
    name: string;
    status: string | null;
    phaseNumber: number;
    missionCount: number;
  }>;
}

export interface OverwatchAsset {
  id: string;
  codename: string;
  specialty: string;
  status: string | null;
  currentStatus: 'idle' | 'in_combat' | 'queued';
  currentMissionTitle: string | null;
}

export interface OverwatchCaptainLog {
  id: string;
  question: string;
  answer: string;
  confidence: string;
  escalated: number | null;
  timestamp: number;
  battlefieldCodename: string;
}

export interface OverwatchStats {
  inCombat: number;
  accomplished: number;
  compromised: number;
  queued: number;
  standby: number;
  cacheHitPercent: number;
  maxAgents: number;
  totalBattlefields: number;
}

export interface OverwatchBattlefieldSummary {
  id: string;
  codename: string;
  missionCount: number;
  activeCount: number;
}

export default function OverwatchPage() {
  const db = getDatabase();

  // Recent missions (last 20, any status, with asset + battlefield joins)
  const missionRows = db
    .select({
      id: missions.id,
      title: missions.title,
      status: missions.status,
      priority: missions.priority,
      costInput: missions.costInput,
      costOutput: missions.costOutput,
      costCacheHit: missions.costCacheHit,
      startedAt: missions.startedAt,
      completedAt: missions.completedAt,
      createdAt: missions.createdAt,
      assetCodename: assets.codename,
      battlefieldCodename: battlefields.codename,
    })
    .from(missions)
    .leftJoin(assets, eq(missions.assetId, assets.id))
    .innerJoin(battlefields, eq(missions.battlefieldId, battlefields.id))
    .orderBy(
      sql`CASE ${missions.status} WHEN 'in_combat' THEN 0 WHEN 'deploying' THEN 1 WHEN 'queued' THEN 2 WHEN 'standby' THEN 3 WHEN 'accomplished' THEN 4 WHEN 'compromised' THEN 5 WHEN 'abandoned' THEN 6 END`,
      desc(missions.createdAt),
    )
    .limit(20)
    .all();

  // Active campaigns with phase progress
  const activeCampaignRows = db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      battlefieldCodename: battlefields.codename,
    })
    .from(campaigns)
    .innerJoin(battlefields, eq(campaigns.battlefieldId, battlefields.id))
    .where(inArray(campaigns.status, ['active', 'planning']))
    .all();

  const activeCampaignsWithPhases: OverwatchCampaign[] = activeCampaignRows.map((c) => {
    const phaseRows = db
      .select({
        id: phases.id,
        name: phases.name,
        status: phases.status,
        phaseNumber: phases.phaseNumber,
      })
      .from(phases)
      .where(eq(phases.campaignId, c.id))
      .orderBy(phases.phaseNumber)
      .all();

    const phasesWithCounts = phaseRows.map((p) => {
      const mCount = db
        .select({ count: sql<number>`count(*)` })
        .from(missions)
        .where(eq(missions.phaseId, p.id))
        .get();
      return { ...p, missionCount: mCount?.count ?? 0 };
    });

    return {
      id: c.id,
      name: c.name,
      status: c.status,
      battlefieldCodename: c.battlefieldCodename,
      phases: phasesWithCounts,
    };
  });

  // Assets with current deployment status
  const assetRows = db.select().from(assets).where(eq(assets.status, 'active')).all();
  const assetDeployment: OverwatchAsset[] = assetRows.map((asset) => {
    const activeMission = db
      .select({ title: missions.title, status: missions.status })
      .from(missions)
      .where(eq(missions.assetId, asset.id))
      .orderBy(desc(missions.createdAt))
      .limit(1)
      .get();

    let currentStatus: 'idle' | 'in_combat' | 'queued' = 'idle';
    let currentMissionTitle: string | null = null;

    if (activeMission) {
      if (activeMission.status === 'in_combat' || activeMission.status === 'deploying') {
        currentStatus = 'in_combat';
        currentMissionTitle = activeMission.title;
      } else if (activeMission.status === 'queued') {
        currentStatus = 'queued';
        currentMissionTitle = activeMission.title;
      }
    }

    return {
      id: asset.id,
      codename: asset.codename,
      specialty: asset.specialty,
      status: asset.status,
      currentStatus,
      currentMissionTitle,
    };
  });

  // Global stats
  const allMissions = db
    .select({ status: missions.status, costInput: missions.costInput, costCacheHit: missions.costCacheHit })
    .from(missions)
    .all();

  const inCombat = allMissions.filter((m) => m.status === 'in_combat' || m.status === 'deploying').length;
  const accomplished = allMissions.filter((m) => m.status === 'accomplished').length;
  const compromised = allMissions.filter((m) => m.status === 'compromised').length;
  const queued = allMissions.filter((m) => m.status === 'queued').length;
  const standby = allMissions.filter((m) => m.status === 'standby').length;

  const totalInput = allMissions.reduce((sum, m) => sum + (m.costInput || 0), 0);
  const totalCacheHit = allMissions.reduce((sum, m) => sum + (m.costCacheHit || 0), 0);
  const cacheHitPercent = totalInput > 0 ? Math.round((totalCacheHit / totalInput) * 100) : 0;

  const totalBattlefields = db
    .select({ count: sql<number>`count(*)` })
    .from(battlefields)
    .where(eq(battlefields.status, 'active'))
    .get()?.count ?? 0;

  const stats: OverwatchStats = {
    inCombat,
    accomplished,
    compromised,
    queued,
    standby,
    cacheHitPercent,
    maxAgents: config.maxAgents,
    totalBattlefields,
  };

  // Recent Captain decisions
  const captainLogRows = db
    .select({
      id: captainLogs.id,
      question: captainLogs.question,
      answer: captainLogs.answer,
      confidence: captainLogs.confidence,
      escalated: captainLogs.escalated,
      timestamp: captainLogs.timestamp,
      battlefieldCodename: battlefields.codename,
    })
    .from(captainLogs)
    .innerJoin(battlefields, eq(captainLogs.battlefieldId, battlefields.id))
    .orderBy(desc(captainLogs.timestamp))
    .limit(10)
    .all();

  // Battlefield summaries for bottom bar
  const bfRows = db
    .select({
      id: battlefields.id,
      codename: battlefields.codename,
    })
    .from(battlefields)
    .where(eq(battlefields.status, 'active'))
    .all();

  const battlefieldSummaries: OverwatchBattlefieldSummary[] = bfRows.map((bf) => {
    const mCount = db
      .select({ count: sql<number>`count(*)` })
      .from(missions)
      .where(eq(missions.battlefieldId, bf.id))
      .get();
    const aCount = db
      .select({ count: sql<number>`count(*)` })
      .from(missions)
      .where(sql`${missions.battlefieldId} = ${bf.id} AND ${missions.status} IN ('in_combat', 'deploying', 'queued')`)
      .get();
    return {
      id: bf.id,
      codename: bf.codename,
      missionCount: mCount?.count ?? 0,
      activeCount: aCount?.count ?? 0,
    };
  });

  return (
    <Overwatch
      stats={stats}
      missions={missionRows}
      campaigns={activeCampaignsWithPhases}
      assetDeployment={assetDeployment}
      captainLogs={captainLogRows}
      battlefieldSummaries={battlefieldSummaries}
    />
  );
}
