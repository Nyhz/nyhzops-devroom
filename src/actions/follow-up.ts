'use server';

import { revalidatePath } from 'next/cache';
import { eq, asc } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { followUpSuggestions } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { extractNextActions } from '@/lib/utils/debrief-parser';
import { createNote } from '@/actions/intel';
import type { FollowUpSuggestion } from '@/types';

// ---------------------------------------------------------------------------
// extractAndSaveSuggestions
// ---------------------------------------------------------------------------

export async function extractAndSaveSuggestions(params: {
  battlefieldId: string;
  missionId?: string;
  campaignId?: string;
  debrief: string;
}): Promise<FollowUpSuggestion[]> {
  const actions = extractNextActions(params.debrief);
  if (actions.length === 0) return [];

  const db = getDatabase();
  const now = Date.now();
  const records: FollowUpSuggestion[] = [];

  for (const suggestion of actions) {
    const record = db
      .insert(followUpSuggestions)
      .values({
        id: generateId(),
        battlefieldId: params.battlefieldId,
        missionId: params.missionId ?? null,
        campaignId: params.campaignId ?? null,
        suggestion,
        status: 'pending',
        intelNoteId: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    records.push(record);
  }

  return records;
}

// ---------------------------------------------------------------------------
// addSuggestionToBoard
// ---------------------------------------------------------------------------

export async function addSuggestionToBoard(suggestionId: string): Promise<void> {
  const db = getDatabase();
  const suggestion = getOrThrow(followUpSuggestions, suggestionId, 'addSuggestionToBoard');

  const note = await createNote(suggestion.battlefieldId, suggestion.suggestion);

  const now = Date.now();
  db.update(followUpSuggestions)
    .set({
      status: 'added',
      intelNoteId: note.id,
      updatedAt: now,
    })
    .where(eq(followUpSuggestions.id, suggestionId))
    .run();

  if (suggestion.missionId) {
    revalidatePath(`/battlefields/${suggestion.battlefieldId}/missions/${suggestion.missionId}`);
  }
  if (suggestion.campaignId) {
    revalidatePath(`/battlefields/${suggestion.battlefieldId}/campaigns/${suggestion.campaignId}`);
  }
}

// ---------------------------------------------------------------------------
// dismissSuggestion
// ---------------------------------------------------------------------------

export async function dismissSuggestion(suggestionId: string): Promise<void> {
  const db = getDatabase();
  const suggestion = getOrThrow(followUpSuggestions, suggestionId, 'dismissSuggestion');

  const now = Date.now();
  db.update(followUpSuggestions)
    .set({
      status: 'dismissed',
      updatedAt: now,
    })
    .where(eq(followUpSuggestions.id, suggestionId))
    .run();

  if (suggestion.missionId) {
    revalidatePath(`/battlefields/${suggestion.battlefieldId}/missions/${suggestion.missionId}`);
  }
  if (suggestion.campaignId) {
    revalidatePath(`/battlefields/${suggestion.battlefieldId}/campaigns/${suggestion.campaignId}`);
  }
}

// ---------------------------------------------------------------------------
// getSuggestions
// ---------------------------------------------------------------------------

export async function getSuggestions(params: {
  missionId?: string;
  campaignId?: string;
}): Promise<FollowUpSuggestion[]> {
  const db = getDatabase();

  if (params.missionId) {
    return db
      .select()
      .from(followUpSuggestions)
      .where(eq(followUpSuggestions.missionId, params.missionId))
      .orderBy(asc(followUpSuggestions.createdAt))
      .all();
  }

  if (params.campaignId) {
    return db
      .select()
      .from(followUpSuggestions)
      .where(eq(followUpSuggestions.campaignId, params.campaignId))
      .orderBy(asc(followUpSuggestions.createdAt))
      .all();
  }

  return [];
}
