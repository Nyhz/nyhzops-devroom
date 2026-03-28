'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/lib/db/index';
import { generalSessions, generalMessages } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';

export async function createGeneralSession(name: string, battlefieldId?: string | null) {
  const db = getDatabase();
  const now = Date.now();
  const id = generateId();

  db.insert(generalSessions)
    .values({
      id,
      name,
      sessionId: null,
      battlefieldId: battlefieldId ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .run();

  revalidatePath('/general');
  return db.select().from(generalSessions).where(eq(generalSessions.id, id)).get()!;
}

export async function closeGeneralSession(sessionId: string) {
  const db = getDatabase();

  // Kill active process if running
  const { killSession } = await import('@/lib/general/general-engine');
  killSession(sessionId);

  db.update(generalSessions)
    .set({ status: 'closed', updatedAt: Date.now() })
    .where(eq(generalSessions.id, sessionId))
    .run();

  revalidatePath('/general');
}

export async function renameGeneralSession(sessionId: string, name: string) {
  const db = getDatabase();

  db.update(generalSessions)
    .set({ name, updatedAt: Date.now() })
    .where(eq(generalSessions.id, sessionId))
    .run();

  revalidatePath('/general');
}

export async function getActiveSessions() {
  const db = getDatabase();
  return db
    .select()
    .from(generalSessions)
    .where(eq(generalSessions.status, 'active'))
    .orderBy(generalSessions.createdAt)
    .all();
}

export async function getSessionMessages(sessionId: string) {
  const db = getDatabase();
  return db
    .select()
    .from(generalMessages)
    .where(eq(generalMessages.sessionId, sessionId))
    .orderBy(generalMessages.timestamp)
    .all();
}
