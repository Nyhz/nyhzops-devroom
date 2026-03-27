'use server';

import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { briefingSessions, briefingMessages } from '@/lib/db/schema';

export async function getBriefingMessages(campaignId: string) {
  const db = getDatabase();

  const session = db.select().from(briefingSessions)
    .where(eq(briefingSessions.campaignId, campaignId)).get();

  if (!session) return [];

  return db.select().from(briefingMessages)
    .where(eq(briefingMessages.briefingId, session.id))
    .orderBy(briefingMessages.timestamp)
    .all();
}

export async function getBriefingSession(campaignId: string) {
  const db = getDatabase();
  return db.select().from(briefingSessions)
    .where(eq(briefingSessions.campaignId, campaignId)).get() ?? null;
}
