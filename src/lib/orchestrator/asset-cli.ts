import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Asset, SkillOverrides } from '@/types';
import { getRulesOfEngagement } from '@/lib/settings/rules-of-engagement';

/**
 * Find the latest version directory for a plugin under its cache path.
 * Returns the full path or null if not found.
 */
function findLatestVersion(pluginBase: string): string | null {
  if (!fs.existsSync(pluginBase)) return null;

  let versions: string[];
  try {
    versions = fs.readdirSync(pluginBase);
  } catch {
    return null;
  }

  if (versions.length === 0) return null;

  const latest = versions.sort().reverse()[0];
  const resolvedPath = path.join(pluginBase, latest);
  return fs.existsSync(resolvedPath) ? resolvedPath : null;
}

/**
 * Read the installed_plugins.json manifest once and cache it.
 */
let _manifest: Record<string, Array<{ installPath: string }>> | null = null;
function getPluginManifest(): Record<string, Array<{ installPath: string }>> {
  if (_manifest) return _manifest;
  const manifestPath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as { plugins: Record<string, Array<{ installPath: string }>> };
    _manifest = parsed.plugins ?? {};
  } catch {
    _manifest = {};
  }
  return _manifest;
}

/**
 * Resolves a skill ID to its plugin directory on disk.
 *
 * Accepts two formats:
 *   - "pluginName:skillName" — the format produced by the discovery scanner / UI toggle
 *   - "name@publisher" — legacy format (used by older seed data)
 *
 * For "pluginName:skillName": looks up the manifest to find the publisher,
 * then resolves the installPath. For multi-skill plugins (e.g. superpowers),
 * returns the skill subdirectory.
 */
function resolveSkillPath(skillId: string): string | null {
  // Legacy "@" format: name@publisher
  const atIdx = skillId.lastIndexOf('@');
  if (atIdx !== -1) {
    const name = skillId.slice(0, atIdx);
    const publisher = skillId.slice(atIdx + 1);
    const pluginBase = path.join(os.homedir(), '.claude', 'plugins', 'cache', publisher, name);
    return findLatestVersion(pluginBase);
  }

  // Scanner format: pluginName:skillName
  const colonIdx = skillId.indexOf(':');
  if (colonIdx === -1) return null;

  const pluginName = skillId.slice(0, colonIdx);
  const skillName = skillId.slice(colonIdx + 1);

  // Find the manifest entry for this plugin (try all publishers)
  const manifest = getPluginManifest();
  for (const [key, entries] of Object.entries(manifest)) {
    const keyName = key.split('@')[0];
    if (keyName === pluginName && entries[0]) {
      const installPath = entries[0].installPath;
      // For multi-skill plugins, check if skills/{skillName} exists
      const skillSubdir = path.join(installPath, 'skills', skillName);
      if (fs.existsSync(skillSubdir)) {
        return skillSubdir;
      }
      // For single-skill plugins (pluginName === skillName), return the install root
      if (pluginName === skillName) {
        return installPath;
      }
      // Fallback: return the install root
      return installPath;
    }
  }

  return null;
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

  // Skill resolution with overrides (before system prompt so we can list them)
  let resolvedSkills: string[] = asset.skills ? (JSON.parse(asset.skills) as string[]) : [];

  if (skillOverrides?.removed) {
    resolvedSkills = resolvedSkills.filter(s => !skillOverrides.removed!.includes(s));
  }
  if (skillOverrides?.added) {
    for (const s of skillOverrides.added) {
      if (!resolvedSkills.includes(s)) resolvedSkills.push(s);
    }
  }

  // --append-system-prompt (prepend shared ROE for mission assets)
  if (asset.systemPrompt) {
    const roe = asset.isSystem === 0 ? getRulesOfEngagement() : '';
    let composed = roe ? `${roe}\n\n${asset.systemPrompt}` : asset.systemPrompt;

    // Append active skill awareness
    if (resolvedSkills.length > 0) {
      const skillNames = resolvedSkills.map((id) => {
        const colonIdx = id.indexOf(':');
        return colonIdx !== -1 ? id.slice(colonIdx + 1) : id;
      });
      composed += `\n\nACTIVE SKILLS: You have the following skills loaded as plugins: ${skillNames.join(', ')}. Use them when relevant to your mission.`;
    }

    args.push('--append-system-prompt', composed);
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
