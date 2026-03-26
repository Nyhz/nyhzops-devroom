'use server';

import { sql, eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { missions, battlefields, assets } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlobalStats {
  totalMissions: number;
  standby: number;
  queued: number;
  deploying: number;
  inCombat: number;
  accomplished: number;
  compromised: number;
  abandoned: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalCostUsd: number;
  cacheHitPercent: number;
}

export interface CostByBattlefield {
  battlefieldId: string;
  codename: string;
  missionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalCostUsd: number;
}

export interface CostByAsset {
  assetId: string;
  codename: string;
  missionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalCostUsd: number;
}

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

export interface RateLimitStatus {
  status: string;
  resetsAt: number;
  rateLimitType: string;
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Token cost calculation (approximate, based on Claude pricing)
// ---------------------------------------------------------------------------

function estimateCostUsd(input: number, output: number, cache: number): number {
  // Approximate USD per token based on Claude Sonnet pricing
  // Input: $3/1M, Output: $15/1M, Cache read: $0.30/1M
  return (input * 3 + output * 15 + cache * 0.3) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function getGlobalStats(): Promise<GlobalStats> {
  const db = getDatabase();

  const rows = db
    .select({
      status: missions.status,
      cnt: sql<number>`count(*)`,
      sumInput: sql<number>`coalesce(sum(${missions.costInput}), 0)`,
      sumOutput: sql<number>`coalesce(sum(${missions.costOutput}), 0)`,
      sumCache: sql<number>`coalesce(sum(${missions.costCacheHit}), 0)`,
    })
    .from(missions)
    .groupBy(missions.status)
    .all();

  let totalMissions = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheTokens = 0;
  const statusCounts: Record<string, number> = {};

  for (const row of rows) {
    const status = row.status ?? 'standby';
    statusCounts[status] = row.cnt;
    totalMissions += row.cnt;
    totalInputTokens += row.sumInput;
    totalOutputTokens += row.sumOutput;
    totalCacheTokens += row.sumCache;
  }

  const cacheHitPercent =
    totalInputTokens > 0
      ? Math.round((totalCacheTokens / totalInputTokens) * 100)
      : 0;

  return {
    totalMissions,
    standby: statusCounts['standby'] ?? 0,
    queued: statusCounts['queued'] ?? 0,
    deploying: statusCounts['deploying'] ?? 0,
    inCombat: statusCounts['in_combat'] ?? 0,
    accomplished: statusCounts['accomplished'] ?? 0,
    compromised: statusCounts['compromised'] ?? 0,
    abandoned: statusCounts['abandoned'] ?? 0,
    totalInputTokens,
    totalOutputTokens,
    totalCacheTokens,
    totalCostUsd: estimateCostUsd(totalInputTokens, totalOutputTokens, totalCacheTokens),
    cacheHitPercent,
  };
}

export async function getCostByBattlefield(): Promise<CostByBattlefield[]> {
  const db = getDatabase();

  const rows = db
    .select({
      battlefieldId: missions.battlefieldId,
      codename: battlefields.codename,
      missionCount: sql<number>`count(*)`,
      totalInputTokens: sql<number>`coalesce(sum(${missions.costInput}), 0)`,
      totalOutputTokens: sql<number>`coalesce(sum(${missions.costOutput}), 0)`,
      totalCacheTokens: sql<number>`coalesce(sum(${missions.costCacheHit}), 0)`,
    })
    .from(missions)
    .innerJoin(battlefields, eq(missions.battlefieldId, battlefields.id))
    .groupBy(missions.battlefieldId)
    .all();

  return rows.map((r) => ({
    battlefieldId: r.battlefieldId,
    codename: r.codename,
    missionCount: r.missionCount,
    totalInputTokens: r.totalInputTokens,
    totalOutputTokens: r.totalOutputTokens,
    totalCacheTokens: r.totalCacheTokens,
    totalCostUsd: estimateCostUsd(r.totalInputTokens, r.totalOutputTokens, r.totalCacheTokens),
  }));
}

export async function getCostByAsset(): Promise<CostByAsset[]> {
  const db = getDatabase();

  const rows = db
    .select({
      assetId: missions.assetId,
      codename: assets.codename,
      missionCount: sql<number>`count(*)`,
      totalInputTokens: sql<number>`coalesce(sum(${missions.costInput}), 0)`,
      totalOutputTokens: sql<number>`coalesce(sum(${missions.costOutput}), 0)`,
      totalCacheTokens: sql<number>`coalesce(sum(${missions.costCacheHit}), 0)`,
    })
    .from(missions)
    .innerJoin(assets, eq(missions.assetId, assets.id))
    .groupBy(missions.assetId)
    .all();

  return rows.map((r) => ({
    assetId: r.assetId ?? '',
    codename: r.codename,
    missionCount: r.missionCount,
    totalInputTokens: r.totalInputTokens,
    totalOutputTokens: r.totalOutputTokens,
    totalCacheTokens: r.totalCacheTokens,
    totalCostUsd: estimateCostUsd(r.totalInputTokens, r.totalOutputTokens, r.totalCacheTokens),
  }));
}

export async function getDailyUsage(days = 30): Promise<DailyUsage[]> {
  const db = getDatabase();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const rows = db
    .select({
      date: sql<string>`date(${missions.createdAt} / 1000, 'unixepoch')`,
      inputTokens: sql<number>`coalesce(sum(${missions.costInput}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${missions.costOutput}), 0)`,
      cacheTokens: sql<number>`coalesce(sum(${missions.costCacheHit}), 0)`,
    })
    .from(missions)
    .where(sql`${missions.createdAt} >= ${cutoff}`)
    .groupBy(sql`date(${missions.createdAt} / 1000, 'unixepoch')`)
    .orderBy(sql`date(${missions.createdAt} / 1000, 'unixepoch')`)
    .all();

  return rows.map((r) => ({
    date: r.date,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheTokens: r.cacheTokens,
  }));
}

export async function getRateLimitStatus(): Promise<RateLimitStatus | null> {
  const rl = globalThis.orchestrator?.latestRateLimit ?? null;
  return rl;
}
