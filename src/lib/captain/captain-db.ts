import { eq, desc, and } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { captainLogs } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import type { CaptainLog, CaptainConfidence } from '@/types';

interface StoreCaptainLogInput {
  missionId: string;
  campaignId: string | null;
  battlefieldId: string;
  question: string;
  answer: string;
  reasoning: string;
  confidence: CaptainConfidence;
  escalated: number;
}

export function storeCaptainLog(data: StoreCaptainLogInput): CaptainLog {
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

  db.insert(captainLogs).values(row).run();
  return row as CaptainLog;
}

export function getRecentCaptainLogs(missionId: string, limit: number = 5): CaptainLog[] {
  const db = getDatabase();
  return db
    .select()
    .from(captainLogs)
    .where(eq(captainLogs.missionId, missionId))
    .orderBy(desc(captainLogs.timestamp))
    .limit(limit)
    .all() as CaptainLog[];
}

export interface CaptainLogFilters {
  missionId?: string;
  battlefieldId?: string;
  campaignId?: string;
  escalatedOnly?: boolean;
}

export function queryCaptainLogs(filters?: CaptainLogFilters): CaptainLog[] {
  const db = getDatabase();
  const conditions = [];

  if (filters?.missionId) {
    conditions.push(eq(captainLogs.missionId, filters.missionId));
  }
  if (filters?.battlefieldId) {
    conditions.push(eq(captainLogs.battlefieldId, filters.battlefieldId));
  }
  if (filters?.campaignId) {
    conditions.push(eq(captainLogs.campaignId, filters.campaignId));
  }
  if (filters?.escalatedOnly) {
    conditions.push(eq(captainLogs.escalated, 1));
  }

  const query = db
    .select()
    .from(captainLogs)
    .orderBy(desc(captainLogs.timestamp));

  if (conditions.length > 0) {
    return query.where(and(...conditions)).all() as CaptainLog[];
  }

  return query.all() as CaptainLog[];
}

export interface CaptainStats {
  totalDecisions: number;
  escalationCount: number;
  escalationRate: number;
  confidenceDistribution: {
    high: number;
    medium: number;
    low: number;
  };
}

export function computeCaptainStats(): CaptainStats {
  const db = getDatabase();
  const allLogs = db.select().from(captainLogs).all() as CaptainLog[];

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
