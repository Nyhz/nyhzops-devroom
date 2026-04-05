'use server';

import { revalidatePath } from 'next/cache';
import { eq, count, inArray } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { assets, missions } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import type { AssetStatus } from '@/types';


export interface AssetDeploymentEntry {
  id: string;
  codename: string;
  status: 'in_combat' | 'queued' | 'reviewing' | 'merging';
  missionTitle: string;
}

export interface AssetDeploymentData {
  active: AssetDeploymentEntry[];
  idle: string[]; // codenames of idle assets
}

// ---------------------------------------------------------------------------
// getAssetDeployment — live deployment status for all active assets
// ---------------------------------------------------------------------------
export async function getAssetDeployment(): Promise<AssetDeploymentData> {
  const db = getDatabase();
  const activeAssets = db.select().from(assets).where(eq(assets.status, 'active')).all();

  // Find all missions currently in active states (including Overseer/Quartermaster work)
  const activeMissions = db
    .select({
      id: missions.id,
      title: missions.title,
      status: missions.status,
      assetId: missions.assetId,
    })
    .from(missions)
    .where(inArray(missions.status, ['in_combat', 'deploying', 'reviewing', 'approved', 'merging', 'queued']))
    .all();

  const active: AssetDeploymentEntry[] = [];
  const busyAssetIds = new Set<string>();

  for (const mission of activeMissions) {
    const asset = activeAssets.find((a) => a.id === mission.assetId);
    if (!asset) continue;

    busyAssetIds.add(asset.id);

    // Map mission status to deployment display status
    let status: AssetDeploymentEntry['status'];
    if (mission.status === 'queued') {
      status = 'queued';
    } else if (mission.status === 'approved' || mission.status === 'merging') {
      status = 'merging';
    } else if (mission.status === 'reviewing') {
      status = 'reviewing';
    } else {
      status = 'in_combat';
    }

    // Show the assigned asset for executor states
    active.push({
      id: mission.id,
      codename: asset.codename,
      status,
      missionTitle: mission.title,
    });

    // Add system asset entries for Overseer (reviewing) and Quartermaster (approved/merging)
    if (mission.status === 'reviewing') {
      active.push({
        id: `${mission.id}:overseer`,
        codename: 'OVERSEER',
        status: 'reviewing',
        missionTitle: mission.title,
      });
    } else if (mission.status === 'approved' || mission.status === 'merging') {
      active.push({
        id: `${mission.id}:quartermaster`,
        codename: 'QUARTERMASTER',
        status: 'merging',
        missionTitle: mission.title,
      });
    }
  }

  const idle = activeAssets
    .filter((a) => !busyAssetIds.has(a.id) && !a.isSystem)
    .map((a) => a.codename);

  return { active, idle };
}

// ---------------------------------------------------------------------------
// getAssetByCodename — look up asset ID by codename
// ---------------------------------------------------------------------------
export async function getAssetByCodename(codename: string): Promise<string | null> {
  const db = getDatabase();
  const upperCodename = codename.toUpperCase().trim();
  const row = db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.codename, upperCodename))
    .get();
  return row?.id ?? null;
}

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

  revalidatePath('/');
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
    memory?: string | null;
    maxTurns?: number | null;
    effort?: string | null;
    skills?: string | null;
    mcpServers?: string | null;
  },
) {
  const db = getDatabase();

  const existing = getOrThrow(assets, id, 'updateAsset');

  const updates: Record<string, unknown> = {};

  if (data.codename !== undefined) {
    // System assets cannot have their codename changed
    if (existing.isSystem) {
      throw new Error('Cannot change codename of system assets');
    }
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

  if (data.memory !== undefined) {
    updates.memory = data.memory;
  }

  if (data.maxTurns !== undefined) {
    updates.maxTurns = data.maxTurns;
  }

  if (data.effort !== undefined) {
    updates.effort = data.effort;
  }

  if (data.skills !== undefined) {
    updates.skills = data.skills;
  }

  if (data.mcpServers !== undefined) {
    updates.mcpServers = data.mcpServers;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  db.update(assets).set(updates).where(eq(assets.id, id)).run();

  revalidatePath('/');
}

// ---------------------------------------------------------------------------
// toggleAssetStatus
// ---------------------------------------------------------------------------
export async function toggleAssetStatus(id: string) {
  const db = getDatabase();
  const asset = getOrThrow(assets, id, 'toggleAssetStatus');

  if (asset.isSystem) {
    throw new Error('Cannot toggle system asset status');
  }

  const newStatus: AssetStatus = asset.status === 'active' ? 'offline' : 'active';
  db.update(assets)
    .set({ status: newStatus })
    .where(eq(assets.id, id))
    .run();

  revalidatePath('/');
}

// ---------------------------------------------------------------------------
// deleteAsset
// ---------------------------------------------------------------------------
export async function deleteAsset(id: string) {
  const db = getDatabase();
  const asset = getOrThrow(assets, id, 'deleteAsset');

  if (asset.isSystem) {
    throw new Error('Cannot delete system assets');
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

  revalidatePath('/');
}

// ---------------------------------------------------------------------------
// getAssetMemory — parse the JSON memory blob into a string array
// ---------------------------------------------------------------------------
const MAX_MEMORY_ENTRIES = 15;

export async function getAssetMemory(assetId: string): Promise<string[]> {
  const db = getDatabase();
  const asset = getOrThrow(assets, assetId, 'getAssetMemory');
  if (!asset.memory) return [];
  try {
    const parsed = JSON.parse(asset.memory);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// updateAssetMemory — apply add/remove/replace operations to the memory array
// ---------------------------------------------------------------------------
export async function updateAssetMemory(
  assetId: string,
  ops: {
    add?: string[];
    remove?: number[];
    replace?: { index: number; value: string }[];
  },
): Promise<{ entries: string[]; error?: string }> {
  const db = getDatabase();
  const asset = getOrThrow(assets, assetId, 'updateAssetMemory');

  let entries: string[] = [];
  if (asset.memory) {
    try {
      const parsed = JSON.parse(asset.memory);
      if (Array.isArray(parsed)) {
        entries = parsed.filter((e): e is string => typeof e === 'string');
      }
    } catch {
      // start fresh
    }
  }

  // Remove (descending order to preserve indices)
  if (ops.remove?.length) {
    const indices = [...ops.remove].sort((a, b) => b - a);
    for (const idx of indices) {
      if (idx >= 0 && idx < entries.length) {
        entries.splice(idx, 1);
      }
    }
  }

  // Replace
  if (ops.replace?.length) {
    for (const { index, value } of ops.replace) {
      if (index >= 0 && index < entries.length) {
        entries[index] = value;
      }
    }
  }

  // Add
  if (ops.add?.length) {
    const remaining = MAX_MEMORY_ENTRIES - entries.length;
    if (remaining <= 0) {
      return { entries, error: 'Memory is at capacity (15 entries)' };
    }
    entries.push(...ops.add.slice(0, remaining));
  }

  // Filter out empty strings
  entries = entries.filter((e) => e.trim().length > 0);

  db.update(assets)
    .set({ memory: JSON.stringify(entries) })
    .where(eq(assets.id, assetId))
    .run();

  revalidatePath('/');
  return { entries };
}
