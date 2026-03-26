'use server';

import { revalidatePath } from 'next/cache';
import { eq, count } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { assets, missions } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import type { AssetStatus } from '@/types';

const VALID_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
] as const;

type ValidModel = (typeof VALID_MODELS)[number];

function isValidModel(model: string): model is ValidModel {
  return (VALID_MODELS as readonly string[]).includes(model);
}

// ---------------------------------------------------------------------------
// createAsset
// ---------------------------------------------------------------------------
export async function createAsset(
  codename: string,
  specialty: string,
  systemPrompt: string,
  model: string,
) {
  const db = getDatabase();
  const upperCodename = codename.toUpperCase().trim();

  if (!upperCodename) {
    throw new Error('Codename is required');
  }
  if (!specialty.trim()) {
    throw new Error('Specialty is required');
  }
  if (!isValidModel(model)) {
    throw new Error(`Invalid model: ${model}. Must be one of: ${VALID_MODELS.join(', ')}`);
  }

  // Check codename uniqueness
  const existing = db
    .select()
    .from(assets)
    .where(eq(assets.codename, upperCodename))
    .get();

  if (existing) {
    throw new Error(`Asset with codename "${upperCodename}" already exists`);
  }

  const id = generateId();
  const now = Date.now();

  db.insert(assets)
    .values({
      id,
      codename: upperCodename,
      specialty: specialty.trim(),
      systemPrompt: systemPrompt.trim() || null,
      model,
      status: 'active',
      missionsCompleted: 0,
      createdAt: now,
    })
    .run();

  revalidatePath('/projects');
  return id;
}

// ---------------------------------------------------------------------------
// updateAsset
// ---------------------------------------------------------------------------
export async function updateAsset(
  id: string,
  data: {
    codename?: string;
    specialty?: string;
    systemPrompt?: string;
    model?: string;
    status?: AssetStatus;
  },
) {
  const db = getDatabase();

  const existing = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!existing) {
    throw new Error(`Asset ${id} not found`);
  }

  const updates: Record<string, unknown> = {};

  if (data.codename !== undefined) {
    const upperCodename = data.codename.toUpperCase().trim();
    if (!upperCodename) {
      throw new Error('Codename is required');
    }
    // Check uniqueness if codename changed
    if (upperCodename !== existing.codename) {
      const dup = db
        .select()
        .from(assets)
        .where(eq(assets.codename, upperCodename))
        .get();
      if (dup) {
        throw new Error(`Asset with codename "${upperCodename}" already exists`);
      }
    }
    updates.codename = upperCodename;
  }

  if (data.specialty !== undefined) {
    const trimmed = data.specialty.trim();
    if (!trimmed) {
      throw new Error('Specialty is required');
    }
    updates.specialty = trimmed;
  }

  if (data.systemPrompt !== undefined) {
    updates.systemPrompt = data.systemPrompt.trim() || null;
  }

  if (data.model !== undefined) {
    if (!isValidModel(data.model)) {
      throw new Error(`Invalid model: ${data.model}`);
    }
    updates.model = data.model;
  }

  if (data.status !== undefined) {
    updates.status = data.status;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  db.update(assets).set(updates).where(eq(assets.id, id)).run();

  revalidatePath('/projects');
}

// ---------------------------------------------------------------------------
// toggleAssetStatus
// ---------------------------------------------------------------------------
export async function toggleAssetStatus(id: string) {
  const db = getDatabase();

  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset) {
    throw new Error(`Asset ${id} not found`);
  }

  const newStatus: AssetStatus = asset.status === 'active' ? 'offline' : 'active';
  db.update(assets)
    .set({ status: newStatus })
    .where(eq(assets.id, id))
    .run();

  revalidatePath('/projects');
}

// ---------------------------------------------------------------------------
// deleteAsset
// ---------------------------------------------------------------------------
export async function deleteAsset(id: string) {
  const db = getDatabase();

  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset) {
    throw new Error(`Asset ${id} not found`);
  }

  // Check if any missions reference this asset
  const [missionRef] = db
    .select({ total: count() })
    .from(missions)
    .where(eq(missions.assetId, id))
    .all();

  if (missionRef && missionRef.total > 0) {
    // Cannot delete — set to offline instead
    db.update(assets)
      .set({ status: 'offline' })
      .where(eq(assets.id, id))
      .run();
  } else {
    db.delete(assets).where(eq(assets.id, id)).run();
  }

  revalidatePath('/projects');
}
