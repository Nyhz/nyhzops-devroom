import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before importing the scanner
vi.mock('fs');
// Mock ulid to produce stable IDs in tests
vi.mock('ulid', () => ({ ulid: vi.fn(() => 'test-ulid') }));

import fs from 'fs';
import { scanHostSkills } from '../skill-scanner';

const PLUGINS_DIR = '/Users/testuser/.claude/plugins';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockExistsSync(paths: Record<string, boolean>) {
  vi.mocked(fs.existsSync).mockImplementation((p) => paths[p as string] ?? false);
}

function makeDirent(name: string, isDir: boolean): fs.Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: '',
    path: '',
  } as fs.Dirent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scanHostSkills', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: home dir resolution needs os.homedir mock
    // We rely on the paths matching — override existsSync conservatively
  });

  it('returns empty arrays when plugins dir does not exist', () => {
    mockExistsSync({ [PLUGINS_DIR]: false });
    // We need to patch os.homedir for the scanner module's PLUGINS_DIR
    // Since the module uses os.homedir() at module scope, we test the real path:
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = scanHostSkills();
    expect(result.skills).toEqual([]);
    expect(result.mcpServers).toEqual([]);
  });

  it('returns empty arrays when manifest does not exist', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      // plugins dir exists but manifest does not
      return s.endsWith('plugins') && !s.includes('installed_plugins');
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = scanHostSkills();
    expect(result.skills).toEqual([]);
    expect(result.mcpServers).toEqual([]);
  });

  it('returns empty arrays when manifest has no plugins', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((p, _enc) => {
      if (String(p).endsWith('installed_plugins.json')) {
        return JSON.stringify({ version: 2, plugins: {} });
      }
      if (String(p).endsWith('settings.json')) {
        return JSON.stringify({});
      }
      throw new Error('ENOENT');
    });
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    const result = scanHostSkills();
    expect(result.skills).toEqual([]);
    expect(result.mcpServers).toEqual([]);
  });

  it('discovers skills from manifest + skill files', () => {
    const installPath = '/Users/testuser/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7';
    const skillsDir = `${installPath}/skills`;
    const brainstormingDir = `${skillsDir}/brainstorming`;
    const skillMdPath = `${brainstormingDir}/SKILL.md`;
    const skillMdContent = `---
name: brainstorming
description: "Brainstorm features before implementing"
---
# Brainstorming`;

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      return [
        // plugins dir
        true, // first call for PLUGINS_DIR
      ].length > 0 && [
        installPath,
        skillsDir,
        brainstormingDir,
        skillMdPath,
      ].some(known => s === known) || s.endsWith('plugins');
    });

    vi.mocked(fs.readFileSync).mockImplementation((p, _enc) => {
      const s = String(p);
      if (s.endsWith('installed_plugins.json')) {
        return JSON.stringify({
          version: 2,
          plugins: {
            'superpowers@claude-plugins-official': [
              {
                scope: 'user',
                installPath,
                version: '5.0.7',
                installedAt: '2026-01-01T00:00:00Z',
                lastUpdated: '2026-01-01T00:00:00Z',
              },
            ],
          },
        });
      }
      if (s.endsWith('settings.json')) {
        return JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } });
      }
      if (s === skillMdPath) {
        return skillMdContent;
      }
      throw new Error(`ENOENT: ${s}`);
    });

    vi.mocked(fs.readdirSync).mockImplementation(((p: unknown, _opts: unknown) => {
      if (String(p) === skillsDir) {
        return [makeDirent('brainstorming', true)];
      }
      return [];
    }) as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const result = scanHostSkills();

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      id: 'superpowers:brainstorming',
      name: 'brainstorming',
      pluginName: 'superpowers',
      description: 'Brainstorm features before implementing',
      pluginDir: brainstormingDir,
    });
    expect(result.mcpServers).toEqual([]);
  });

  it('discovers MCP servers from plugin .mcp.json configs', () => {
    const installPath = '/Users/testuser/.claude/plugins/cache/claude-plugins-official/telegram/0.0.4';
    const skillsDir = `${installPath}/skills`;
    const mcpConfigPath = `${installPath}/.mcp.json`;
    const mcpConfigContent = JSON.stringify({
      mcpServers: {
        telegram: {
          command: 'bun',
          args: ['run', '--cwd', '${CLAUDE_PLUGIN_ROOT}', 'start'],
        },
      },
    });

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('plugins') || s === skillsDir || s === mcpConfigPath) return true;
      return false;
    });

    vi.mocked(fs.readFileSync).mockImplementation((p, _enc) => {
      const s = String(p);
      if (s.endsWith('installed_plugins.json')) {
        return JSON.stringify({
          version: 2,
          plugins: {
            'telegram@claude-plugins-official': [
              {
                scope: 'user',
                installPath,
                version: '0.0.4',
                installedAt: '2026-01-01T00:00:00Z',
                lastUpdated: '2026-01-01T00:00:00Z',
              },
            ],
          },
        });
      }
      if (s.endsWith('settings.json')) {
        return JSON.stringify({});
      }
      if (s === mcpConfigPath) {
        return mcpConfigContent;
      }
      throw new Error(`ENOENT: ${s}`);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);

    const result = scanHostSkills();

    expect(result.mcpServers).toHaveLength(1);
    expect(result.mcpServers[0]).toMatchObject({
      name: 'telegram',
      command: 'bun',
      args: ['run', '--cwd', '${CLAUDE_PLUGIN_ROOT}', 'start'],
      source: 'plugin:telegram',
    });
    expect(result.skills).toEqual([]);
  });

  it('discovers user-level MCP servers from settings.json', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).endsWith('plugins');
    });

    vi.mocked(fs.readFileSync).mockImplementation((p, _enc) => {
      const s = String(p);
      if (s.endsWith('installed_plugins.json')) {
        return JSON.stringify({ version: 2, plugins: {} });
      }
      if (s.endsWith('settings.json')) {
        return JSON.stringify({
          mcpServers: {
            'my-custom-server': {
              command: 'node',
              args: ['/usr/local/bin/my-mcp-server'],
            },
          },
        });
      }
      throw new Error(`ENOENT: ${s}`);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);

    const result = scanHostSkills();

    expect(result.mcpServers).toHaveLength(1);
    expect(result.mcpServers[0]).toMatchObject({
      name: 'my-custom-server',
      command: 'node',
      args: ['/usr/local/bin/my-mcp-server'],
      source: 'settings',
    });
  });

  it('skips disabled plugins', () => {
    const installPath = '/Users/testuser/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7';
    const skillsDir = `${installPath}/skills`;

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).endsWith('plugins') || String(p) === skillsDir;
    });

    vi.mocked(fs.readFileSync).mockImplementation((p, _enc) => {
      const s = String(p);
      if (s.endsWith('installed_plugins.json')) {
        return JSON.stringify({
          version: 2,
          plugins: {
            'superpowers@claude-plugins-official': [
              {
                scope: 'user',
                installPath,
                version: '5.0.7',
                installedAt: '2026-01-01T00:00:00Z',
                lastUpdated: '2026-01-01T00:00:00Z',
              },
            ],
          },
        });
      }
      if (s.endsWith('settings.json')) {
        return JSON.stringify({
          enabledPlugins: { 'superpowers@claude-plugins-official': false },
        });
      }
      throw new Error(`ENOENT: ${s}`);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);

    const result = scanHostSkills();
    expect(result.skills).toEqual([]);
    expect(result.mcpServers).toEqual([]);
  });
});
