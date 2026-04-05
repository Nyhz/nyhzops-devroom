import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Asset, SkillOverrides } from '@/types';
import { getRulesOfEngagement } from '@/lib/settings/rules-of-engagement';

/**
 * Resolves a skill ID (format: "name@publisher") to its plugin directory on disk.
 * Looks for the latest version directory under ~/.claude/plugins/cache/{publisher}/{name}/
 * Returns the path if it exists, or null if not found.
 */
function resolveSkillPath(skillId: string): string | null {
  const atIdx = skillId.lastIndexOf('@');
  if (atIdx === -1) return null;

  const name = skillId.slice(0, atIdx);
  const publisher = skillId.slice(atIdx + 1);

  const pluginBase = path.join(os.homedir(), '.claude', 'plugins', 'cache', publisher, name);

  if (!fs.existsSync(pluginBase)) return null;

  // Find the latest version directory
  let versions: string[];
  try {
    versions = fs.readdirSync(pluginBase);
  } catch {
    return null;
  }

  if (versions.length === 0) return null;

  // Sort versions descending and pick the first (latest)
  const latest = versions.sort().reverse()[0];
  const resolvedPath = path.join(pluginBase, latest);

  if (!fs.existsSync(resolvedPath)) return null;

  return resolvedPath;
}

/**
 * Translates an Asset config (plus optional skill overrides) into Claude Code CLI flags.
 */
export function buildAssetCliArgs(
  asset: Asset,
  skillOverrides?: SkillOverrides | null,
): string[] {
  const args: string[] = [];

  // --model
  if (asset.model) {
    args.push('--model', asset.model);
  }

  // --max-turns
  if (asset.maxTurns != null) {
    args.push('--max-turns', String(asset.maxTurns));
  }

  // --effort
  if (asset.effort) {
    args.push('--effort', asset.effort);
  }

  // --append-system-prompt (prepend shared ROE for mission assets)
  if (asset.systemPrompt) {
    const roe = asset.isSystem === 0 ? getRulesOfEngagement() : '';
    const composed = roe ? `${roe}\n\n${asset.systemPrompt}` : asset.systemPrompt;
    args.push('--append-system-prompt', composed);
  }

  // Skill resolution with overrides
  let resolvedSkills: string[] = asset.skills ? (JSON.parse(asset.skills) as string[]) : [];

  if (skillOverrides?.removed) {
    resolvedSkills = resolvedSkills.filter(s => !skillOverrides.removed!.includes(s));
  }
  if (skillOverrides?.added) {
    for (const s of skillOverrides.added) {
      if (!resolvedSkills.includes(s)) resolvedSkills.push(s);
    }
  }

  // --plugin-dir for each resolved skill
  for (const skillId of resolvedSkills) {
    const pluginDir = resolveSkillPath(skillId);
    if (pluginDir) {
      args.push('--plugin-dir', pluginDir);
    }
  }

  // --mcp-config
  if (asset.mcpServers) {
    // Validate it's non-empty JSON object/array
    try {
      const parsed = JSON.parse(asset.mcpServers) as unknown;
      const isEmpty =
        parsed === null ||
        (typeof parsed === 'object' && Object.keys(parsed as object).length === 0);
      if (!isEmpty) {
        args.push('--mcp-config', asset.mcpServers);
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  return args;
}
