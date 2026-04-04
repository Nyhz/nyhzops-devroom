'use server';

import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Shared helper: resolve repoPath from battlefieldId
// ---------------------------------------------------------------------------
export async function getRepoPath(battlefieldId: string): Promise<string> {
  const db = getDatabase();
  const battlefield = db
    .select({ repoPath: battlefields.repoPath })
    .from(battlefields)
    .where(eq(battlefields.id, battlefieldId))
    .get();

  if (!battlefield) {
    throw new Error(`Battlefield ${battlefieldId} not found`);
  }

  return battlefield.repoPath;
}
