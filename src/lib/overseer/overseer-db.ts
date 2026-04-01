import { eq, desc, and } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { overseerLogs } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import type { OverseerLog, OverseerConfidence } from '@/types';

interface StoreOverseerLogInput {
  missionId: string;
  campaignId: string | null;
  battlefieldId: string;
  question: string;
  answer: string;
  reasoning: string;
  confidence: OverseerConfidence;
  escalated: number;
}

export function storeOverseerLog(data: StoreOverseerLogInput): OverseerLog {
  const db = getDatabase();
  const row = {
    id: generateId(),
    missionId: data.missionId,
    campaignId: data.campaignId,
    battlefieldId: data.battlefieldId,
    question: data.question,
    answer: data.answer,
    reasoning: data.reasoning,
    confidence: data.confidence,
    escalated: data.escalated,
    timestamp: Date.now(),
  };

  db.insert(overseerLogs).values(row).run();
  return row as OverseerLog;
}

export function getRecentOverseerLogs(missionId: string, limit: number = 5): OverseerLog[] {
  const db = getDatabase();
  return db
    .select()
    .from(overseerLogs)
    .where(eq(overseerLogs.missionId, missionId))
    .orderBy(desc(overseerLogs.timestamp))
    .limit(limit)
    .all() as OverseerLog[];
}

export interface OverseerLogFilters {
  missionId?: string;
  battlefieldId?: string;
  campaignId?: string;
  escalatedOnly?: boolean;
}

export function queryOverseerLogs(filters?: OverseerLogFilters): OverseerLog[] {
  const db = getDatabase();
  const conditions = [];

  if (filters?.missionId) {
    conditions.push(eq(overseerLogs.missionId, filters.missionId));
  }
  if (filters?.battlefieldId) {
    conditions.push(eq(overseerLogs.battlefieldId, filters.battlefieldId));
  }
  if (filters?.campaignId) {
    conditions.push(eq(overseerLogs.campaignId, filters.campaignId));
  }
  if (filters?.escalatedOnly) {
    conditions.push(eq(overseerLogs.escalated, 1));
  }

  const query = db
    .select()
    .from(overseerLogs)
    .orderBy(desc(overseerLogs.timestamp));

  if (conditions.length > 0) {
    return query.where(and(...conditions)).all() as OverseerLog[];
  }

  return query.all() as OverseerLog[];
}

export interface OverseerStats {
  totalDecisions: number;
  escalationCount: number;
  escalationRate: number;
  confidenceDistribution: {
    high: number;
    medium: number;
    low: number;
  };
}

export function computeOverseerStats(): OverseerStats {
  const db = getDatabase();
  const allLogs = db.select().from(overseerLogs).all() as OverseerLog[];

  const total = allLogs.length;
  const escalations = allLogs.filter((l) => l.escalated === 1).length;
  const high = allLogs.filter((l) => l.confidence === 'high').length;
  const medium = allLogs.filter((l) => l.confidence === 'medium').length;
  const low = allLogs.filter((l) => l.confidence === 'low').length;

  return {
    totalDecisions: total,
    escalationCount: escalations,
    escalationRate: total > 0 ? escalations / total : 0,
    confidenceDistribution: { high, medium, low },
  };
}
