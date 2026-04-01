import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import type { Asset } from '@/types';

/**
 * Cached lookup for system assets (OVERSEER, GENERAL, QUARTERMASTER).
 * Lives outside 'use server' actions file to avoid the async requirement.
 */
const systemAssetCache = new Map<string, { asset: Asset; cachedAt: number }>();
const SYSTEM_ASSET_CACHE_TTL = 60_000;

export function getSystemAsset(codename: string): Asset {
  const now = Date.now();
  const cached = systemAssetCache.get(codename);
  if (cached && (now - cached.cachedAt) < SYSTEM_ASSET_CACHE_TTL) {
    return cached.asset;
  }
  const db = getDatabase();
  const asset = db.select().from(assets).where(eq(assets.codename, codename)).get();
  if (!asset) throw new Error(`System asset ${codename} not found. Run seed.`);
  systemAssetCache.set(codename, { asset, cachedAt: now });
  return asset;
}
