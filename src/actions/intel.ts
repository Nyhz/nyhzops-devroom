'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { intelNotes, missions, assets, followUpSuggestions } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import type { IntelNote, IntelNoteWithMission, IntelNoteColumn } from '@/types';

// ---------------------------------------------------------------------------
// listBoardNotes
// ---------------------------------------------------------------------------

export async function listBoardNotes(
  battlefieldId: string,
): Promise<IntelNoteWithMission[]> {
  const db = getDatabase();

  const rows = db
    .select({
      // All intelNotes columns
      id: intelNotes.id,
      battlefieldId: intelNotes.battlefieldId,
      title: intelNotes.title,
      description: intelNotes.description,
      column: intelNotes.column,
      position: intelNotes.position,
      missionId: intelNotes.missionId,
      campaignId: intelNotes.campaignId,
      createdAt: intelNotes.createdAt,
      updatedAt: intelNotes.updatedAt,
      // Joined columns
      missionStatus: missions.status,
      missionAssetCodename: assets.codename,
      missionCreatedAt: missions.createdAt,
    })
    .from(intelNotes)
    .leftJoin(missions, eq(intelNotes.missionId, missions.id))
    .leftJoin(assets, eq(missions.assetId, assets.id))
    .where(eq(intelNotes.battlefieldId, battlefieldId))
    .orderBy(intelNotes.position, desc(intelNotes.createdAt))
    .all();

  return rows.map((row) => ({
    ...row,
    missionStatus: row.missionStatus ?? null,
    missionAssetCodename: row.missionAssetCodename ?? null,
    missionCreatedAt: row.missionCreatedAt ?? null,
  })) as IntelNoteWithMission[];
}

// ---------------------------------------------------------------------------
// createNote
// ---------------------------------------------------------------------------

export async function createNote(
  battlefieldId: string,
  title: string,
  description?: string,
): Promise<IntelNote> {
  const db = getDatabase();
  const id = generateId();
  const now = Date.now();

  // Shift existing backlog notes down to make room at position 0 (unpromoted only)
  db.update(intelNotes)
    .set({
      position: sql`${intelNotes.position} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(intelNotes.battlefieldId, battlefieldId),
        eq(intelNotes.column, 'backlog'),
        isNull(intelNotes.missionId),
      ),
    )
    .run();

  const record = db
    .insert(intelNotes)
    .values({
      id,
      battlefieldId,
      title: title.trim(),
      description: description ?? null,
      column: 'backlog',
      position: 0,
      missionId: null,
      campaignId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  revalidatePath(`/battlefields/${battlefieldId}/board`);

  return record;
}

// ---------------------------------------------------------------------------
// updateNote
// ---------------------------------------------------------------------------

export async function updateNote(
  noteId: string,
  data: { title?: string; description?: string },
): Promise<IntelNote> {
  const db = getDatabase();
  const note = getOrThrow(intelNotes, noteId, 'updateNote');

  if (note.missionId) {
    throw new Error(
      `updateNote: note ${noteId} is linked to a mission and cannot be edited`,
    );
  }

  const now = Date.now();

  const updated = db
    .update(intelNotes)
    .set({
      ...data,
      updatedAt: now,
    })
    .where(eq(intelNotes.id, noteId))
    .returning()
    .get();

  if (!updated) {
    throw new Error(`updateNote: update failed for note ${noteId}`);
  }

  revalidatePath(`/battlefields/${note.battlefieldId}/board`);

  return updated;
}

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------

export async function deleteNote(noteId: string): Promise<void> {
  const db = getDatabase();
  const note = getOrThrow(intelNotes, noteId, 'deleteNote');

  // Clear any follow_up_suggestions that reference this note
  db.update(followUpSuggestions)
    .set({ intelNoteId: null })
    .where(eq(followUpSuggestions.intelNoteId, noteId))
    .run();

  db.delete(intelNotes).where(eq(intelNotes.id, noteId)).run();

  revalidatePath(`/battlefields/${note.battlefieldId}/board`);
}

// ---------------------------------------------------------------------------
// moveNote
// ---------------------------------------------------------------------------

export async function moveNote(
  noteId: string,
  targetColumn: IntelNoteColumn,
  targetPosition: number,
): Promise<IntelNote> {
  const db = getDatabase();
  const note = getOrThrow(intelNotes, noteId, 'moveNote');

  if (note.missionId) {
    throw new Error(
      `moveNote: note ${noteId} is linked to a mission and cannot be moved`,
    );
  }

  const now = Date.now();

  const updated = db
    .update(intelNotes)
    .set({
      column: targetColumn,
      position: targetPosition,
      updatedAt: now,
    })
    .where(eq(intelNotes.id, noteId))
    .returning()
    .get();

  if (!updated) {
    throw new Error(`moveNote: update failed for note ${noteId}`);
  }

  revalidatePath(`/battlefields/${note.battlefieldId}/board`);

  return updated;
}

// ---------------------------------------------------------------------------
// linkNoteToMission
// ---------------------------------------------------------------------------

export async function linkNoteToMission(
  noteId: string,
  missionId: string,
): Promise<IntelNote> {
  const db = getDatabase();
  const note = getOrThrow(intelNotes, noteId, 'linkNoteToMission');

  const now = Date.now();

  const updated = db
    .update(intelNotes)
    .set({
      missionId,
      updatedAt: now,
    })
    .where(eq(intelNotes.id, noteId))
    .returning()
    .get();

  if (!updated) {
    throw new Error(`linkNoteToMission: update failed for note ${noteId}`);
  }

  revalidatePath(`/battlefields/${note.battlefieldId}/board`);

  return updated;
}

// ---------------------------------------------------------------------------
// linkNotesToCampaign
// ---------------------------------------------------------------------------

export async function linkNotesToCampaign(
  noteIds: string[],
  campaignId: string,
): Promise<void> {
  if (noteIds.length === 0) return;

  const db = getDatabase();
  const now = Date.now();

  // Fetch one note to get battlefieldId for revalidation
  const firstNote = getOrThrow(intelNotes, noteIds[0], 'linkNotesToCampaign');

  for (const noteId of noteIds) {
    db.update(intelNotes)
      .set({
        campaignId,
        updatedAt: now,
      })
      .where(eq(intelNotes.id, noteId))
      .run();
  }

  revalidatePath(`/battlefields/${firstNote.battlefieldId}/board`);
}

// ---------------------------------------------------------------------------
// getNote
// ---------------------------------------------------------------------------

export async function getNote(noteId: string): Promise<IntelNote> {
  return getOrThrow(intelNotes, noteId, 'getNote');
}

// ---------------------------------------------------------------------------
// backfillIntelNotes — create intel notes for existing missions that lack one
// ---------------------------------------------------------------------------
export async function backfillIntelNotes(battlefieldId: string): Promise<number> {
  const db = getDatabase();
  const now = Date.now();

  // Find missions in this battlefield that don't have an intel note
  const missionsWithoutNotes = db
    .select({ id: missions.id, title: missions.title, campaignId: missions.campaignId })
    .from(missions)
    .where(eq(missions.battlefieldId, battlefieldId))
    .all()
    .filter(m => {
      const existing = db
        .select({ id: intelNotes.id })
        .from(intelNotes)
        .where(eq(intelNotes.missionId, m.id))
        .get();
      return !existing;
    });

  for (const m of missionsWithoutNotes) {
    db.insert(intelNotes)
      .values({
        id: generateId(),
        battlefieldId,
        title: m.title,
        description: null,
        missionId: m.id,
        campaignId: m.campaignId,
        column: 'backlog',
        position: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  return missionsWithoutNotes.length;
}
