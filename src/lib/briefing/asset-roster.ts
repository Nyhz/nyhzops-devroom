import type { Asset } from '@/types';

const IDENTITY_LINE_CAP = 200;

/**
 * Extract the first meaningful line of an asset's system prompt,
 * stripped of the "You are CODENAME — " identity prefix and capped.
 */
export function extractAssetIdentityLine(systemPrompt: string | null): string {
  if (!systemPrompt) return '';

  // First non-empty line
  const firstLine = systemPrompt
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  if (!firstLine) return '';

  // Strip "You are X — " / "You are X - " prefix (handles em-dash and hyphen)
  const stripped = firstLine.replace(
    /^You are\s+[A-Z][A-Z0-9_\- ]*\s*[—-]\s*/,
    '',
  );

  return stripped.length > IDENTITY_LINE_CAP
    ? stripped.slice(0, IDENTITY_LINE_CAP)
    : stripped;
}

/**
 * Render the set of mission assets STRATEGIST is allowed to assign.
 * Filters out system assets and inactive assets, sorts by codename for
 * deterministic output (matters for prompt caching), and includes each
 * asset's first-line identity from its system prompt when available.
 */
export function formatAssetRoster(allAssets: Asset[]): string {
  const mission = allAssets
    .filter((a) => a.status === 'active' && a.isSystem === 0)
    .sort((a, b) => a.codename.localeCompare(b.codename));

  if (mission.length === 0) return '(no active mission assets)';

  return mission
    .map((a) => {
      const identity = extractAssetIdentityLine(a.systemPrompt);
      const head = `- ${a.codename} (${a.specialty})`;
      return identity ? `${head}: ${identity}` : head;
    })
    .join('\n');
}
