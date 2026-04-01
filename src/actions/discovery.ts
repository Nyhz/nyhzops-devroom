'use server';

import { scanHostSkills } from '@/lib/discovery/skill-scanner';
import type { DiscoveredSkill, DiscoveredMcp } from '@/types';

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface DiscoveryCache {
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcp[];
  cachedAt: number;
}

let cache: DiscoveryCache | null = null;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Return the latest discovery results.
 * Re-scans when the cache is stale or missing.
 */
export async function getAvailableSkillsAndMcps(): Promise<{
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcp[];
}> {
  const now = Date.now();
  if (cache && now - cache.cachedAt < CACHE_TTL_MS) {
    return { skills: cache.skills, mcpServers: cache.mcpServers };
  }

  const { skills, mcpServers } = scanHostSkills();
  cache = { skills, mcpServers, cachedAt: now };
  return { skills, mcpServers };
}

/**
 * Force a re-scan and return fresh results.
 */
export async function refreshDiscoveryCache(): Promise<{
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcp[];
}> {
  cache = null;
  return getAvailableSkillsAndMcps();
}
