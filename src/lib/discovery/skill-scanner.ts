import fs from 'fs';
import path from 'path';
import os from 'os';
import { ulid } from 'ulid';
import type { DiscoveredSkill, DiscoveredMcp } from '@/types';

const PLUGINS_DIR = path.join(os.homedir(), '.claude', 'plugins');
const MANIFEST_PATH = path.join(PLUGINS_DIR, 'installed_plugins.json');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

interface PluginInstallEntry {
  scope: string;
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha?: string;
}

interface InstalledPluginsManifest {
  version: number;
  plugins: Record<string, PluginInstallEntry[]>;
}

interface McpServerEntry {
  command: string;
  args?: string[];
}

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

interface ClaudeSettings {
  mcpServers?: Record<string, McpServerEntry>;
  enabledPlugins?: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeReadJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Extract the `description:` value from YAML frontmatter in a markdown file.
 * Handles both quoted and unquoted values.
 */
function extractFrontmatterDescription(content: string): string {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return '';
  const block = fmMatch[1];
  // Match `description: "..."` or `description: ...`
  const descMatch = block.match(/^description:\s*"(.+?)"\s*$/m)
    ?? block.match(/^description:\s*(.+?)\s*$/m);
  return descMatch ? descMatch[1].trim() : '';
}

/**
 * Derive a human-readable skill name from the plugin key and the skill
 * directory/file name. For a plugin key like "superpowers@claude-plugins-official"
 * and skill name "brainstorming" this returns "superpowers:brainstorming".
 */
function buildSkillId(pluginKey: string, skillName: string): string {
  // pluginKey format: "name@publisher"
  const pluginName = pluginKey.split('@')[0] ?? pluginKey;
  return `${pluginName}:${skillName}`;
}

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

export interface ScanResult {
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcp[];
}

/**
 * Scan `~/.claude/plugins/` for available skills and MCP servers.
 *
 * Returns empty arrays if the plugins directory or manifest do not exist.
 */
export function scanHostSkills(): ScanResult {
  const result: ScanResult = { skills: [], mcpServers: [] };

  // 1. Guard: plugins dir must exist
  if (!fs.existsSync(PLUGINS_DIR)) {
    return result;
  }

  // 2. Read manifest
  const manifest = safeReadJson<InstalledPluginsManifest>(MANIFEST_PATH);
  if (!manifest?.plugins) {
    return result;
  }

  // 3. Read enabledPlugins from settings (if present) to honour disable flags
  const settings = safeReadJson<ClaudeSettings>(SETTINGS_PATH);
  const enabledPlugins = settings?.enabledPlugins ?? {};

  // 4. Process each plugin entry
  for (const [pluginKey, entries] of Object.entries(manifest.plugins)) {
    // If settings explicitly disables the plugin, skip it
    if (Object.keys(enabledPlugins).length > 0 && enabledPlugins[pluginKey] === false) {
      continue;
    }

    // Use the first (most recent) install entry
    const entry = entries[0];
    if (!entry) continue;

    const installPath = entry.installPath;

    // 4a. Discover skills in installPath/skills/
    const skillsDir = path.join(installPath, 'skills');
    if (fs.existsSync(skillsDir)) {
      const skillEntries = (() => {
        try {
          return fs.readdirSync(skillsDir, { withFileTypes: true });
        } catch {
          return [];
        }
      })();

      for (const dirent of skillEntries) {
        if (dirent.isDirectory()) {
          // Each sub-directory is a skill; look for SKILL.md inside
          const skillDir = path.join(skillsDir, dirent.name);
          const skillMdPath = path.join(skillDir, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            const content = (() => {
              try { return fs.readFileSync(skillMdPath, 'utf-8'); } catch { return ''; }
            })();
            const description = extractFrontmatterDescription(content);
            const pluginName = pluginKey.split('@')[0] ?? pluginKey;
            result.skills.push({
              id: buildSkillId(pluginKey, dirent.name),
              name: dirent.name,
              pluginName,
              description,
              pluginDir: skillDir,
            });
          }
        } else if (dirent.isFile() && dirent.name.endsWith('.md')) {
          // Flat .md skill files (less common, but handle for completeness)
          const skillName = dirent.name.replace(/\.md$/, '');
          const filePath = path.join(skillsDir, dirent.name);
          const content = (() => {
            try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
          })();
          const description = extractFrontmatterDescription(content);
          const pluginName = pluginKey.split('@')[0] ?? pluginKey;
          result.skills.push({
            id: buildSkillId(pluginKey, skillName),
            name: skillName,
            pluginName,
            description,
            pluginDir: skillsDir,
          });
        }
      }
    }

    // 4b. Discover MCP servers from installPath/.mcp.json
    const mcpConfigPath = path.join(installPath, '.mcp.json');
    const mcpConfig = safeReadJson<McpConfig>(mcpConfigPath);
    if (mcpConfig?.mcpServers) {
      for (const [serverName, serverEntry] of Object.entries(mcpConfig.mcpServers)) {
        result.mcpServers.push({
          id: ulid(),
          name: serverName,
          command: serverEntry.command,
          args: serverEntry.args ?? [],
          source: `plugin:${pluginKey.split('@')[0] ?? pluginKey}`,
        });
      }
    }

    // 4c. Also check for config.json (alternative MCP config location)
    const configJsonPath = path.join(installPath, 'config.json');
    const configJson = safeReadJson<McpConfig>(configJsonPath);
    if (configJson?.mcpServers) {
      for (const [serverName, serverEntry] of Object.entries(configJson.mcpServers)) {
        result.mcpServers.push({
          id: ulid(),
          name: serverName,
          command: serverEntry.command,
          args: serverEntry.args ?? [],
          source: `plugin:${pluginKey.split('@')[0] ?? pluginKey}`,
        });
      }
    }
  }

  // 5. Check ~/.claude/settings.json for user-level MCP servers
  if (settings?.mcpServers) {
    for (const [serverName, serverEntry] of Object.entries(settings.mcpServers)) {
      result.mcpServers.push({
        id: ulid(),
        name: serverName,
        command: serverEntry.command,
        args: serverEntry.args ?? [],
        source: 'settings',
      });
    }
  }

  return result;
}
