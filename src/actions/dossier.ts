'use server';

import { revalidatePath } from 'next/cache';
import { eq, asc } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { dossiers } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import type { Dossier, DossierVariable } from '@/types';

// ---------------------------------------------------------------------------
// listDossiers
// ---------------------------------------------------------------------------
export async function listDossiers(): Promise<Dossier[]> {
  const db = getDatabase();
  return db.select().from(dossiers).orderBy(asc(dossiers.codename)).all();
}

// ---------------------------------------------------------------------------
// getDossier
// ---------------------------------------------------------------------------
export async function getDossier(id: string): Promise<Dossier | undefined> {
  const db = getDatabase();
  return db.select().from(dossiers).where(eq(dossiers.id, id)).get();
}

// ---------------------------------------------------------------------------
// createDossier
// ---------------------------------------------------------------------------
export async function createDossier(data: {
  codename: string;
  name: string;
  description?: string;
  briefingTemplate: string;
  variables?: DossierVariable[];
  assetCodename?: string;
}): Promise<string> {
  const db = getDatabase();
  const upperCodename = data.codename.toUpperCase().trim();

  if (!upperCodename) {
    throw new Error('Codename is required');
  }
  if (!data.name.trim()) {
    throw new Error('Name is required');
  }
  if (!data.briefingTemplate.trim()) {
    throw new Error('Briefing template is required');
  }

  // Check codename uniqueness
  const existing = db
    .select()
    .from(dossiers)
    .where(eq(dossiers.codename, upperCodename))
    .get();

  if (existing) {
    throw new Error(`Dossier with codename "${upperCodename}" already exists`);
  }

  const id = generateId();
  const now = Date.now();

  db.insert(dossiers)
    .values({
      id,
      codename: upperCodename,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      briefingTemplate: data.briefingTemplate.trim(),
      variables: data.variables ? JSON.stringify(data.variables) : null,
      assetCodename: data.assetCodename?.trim() || null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  revalidatePath('/');
  return id;
}

// ---------------------------------------------------------------------------
// updateDossier
// ---------------------------------------------------------------------------
export async function updateDossier(
  id: string,
  data: {
    codename?: string;
    name?: string;
    description?: string;
    briefingTemplate?: string;
    variables?: DossierVariable[];
    assetCodename?: string;
  },
): Promise<void> {
  const db = getDatabase();

  const existing = db.select().from(dossiers).where(eq(dossiers.id, id)).get();
  if (!existing) {
    throw new Error(`Dossier ${id} not found`);
  }

  const updates: Record<string, unknown> = { updatedAt: Date.now() };

  if (data.codename !== undefined) {
    const upperCodename = data.codename.toUpperCase().trim();
    if (!upperCodename) {
      throw new Error('Codename is required');
    }
    if (upperCodename !== existing.codename) {
      const dup = db
        .select()
        .from(dossiers)
        .where(eq(dossiers.codename, upperCodename))
        .get();
      if (dup) {
        throw new Error(`Dossier with codename "${upperCodename}" already exists`);
      }
    }
    updates.codename = upperCodename;
  }

  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) {
      throw new Error('Name is required');
    }
    updates.name = trimmed;
  }

  if (data.description !== undefined) {
    updates.description = data.description.trim() || null;
  }

  if (data.briefingTemplate !== undefined) {
    const trimmed = data.briefingTemplate.trim();
    if (!trimmed) {
      throw new Error('Briefing template is required');
    }
    updates.briefingTemplate = trimmed;
  }

  if (data.variables !== undefined) {
    updates.variables = JSON.stringify(data.variables);
  }

  if (data.assetCodename !== undefined) {
    updates.assetCodename = data.assetCodename.trim() || null;
  }

  db.update(dossiers).set(updates).where(eq(dossiers.id, id)).run();

  revalidatePath('/');
}

// ---------------------------------------------------------------------------
// deleteDossier
// ---------------------------------------------------------------------------
export async function deleteDossier(id: string): Promise<void> {
  const db = getDatabase();

  const existing = db.select().from(dossiers).where(eq(dossiers.id, id)).get();
  if (!existing) {
    throw new Error(`Dossier ${id} not found`);
  }

  db.delete(dossiers).where(eq(dossiers.id, id)).run();

  revalidatePath('/');
}

// ---------------------------------------------------------------------------
// resolveDossier
// ---------------------------------------------------------------------------
export async function resolveDossier(
  id: string,
  values: Record<string, string>,
): Promise<{ briefing: string; assetCodename: string | null }> {
  const db = getDatabase();

  const dossier = db.select().from(dossiers).where(eq(dossiers.id, id)).get();
  if (!dossier) {
    throw new Error(`Dossier ${id} not found`);
  }

  let briefing = dossier.briefingTemplate;

  // Replace all {{KEY}} placeholders with provided values
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    briefing = briefing.replace(pattern, value);
  }

  return {
    briefing,
    assetCodename: dossier.assetCodename,
  };
}
