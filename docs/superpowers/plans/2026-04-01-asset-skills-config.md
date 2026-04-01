# Asset Skills & MCP Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Claude Code spawn point configurable via per-asset skills, MCPs, model, effort, and editable system prompts — with per-mission overrides during campaign planning.

**Architecture:** Extend the assets table with skill/MCP config columns. Build a host scanner that discovers installed plugins. Create `buildAssetCliArgs()` that all spawn points call. Migrate hardcoded prompts into DB-editable asset system prompts. Build asset detail page with tabs and campaign mission skill override panel.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM + better-sqlite3, Tailwind CSS 4, Vitest, Claude Code CLI flags (`--append-system-prompt`, `--plugin-dir`, `--mcp-config`, `--model`, `--effort`)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/lib/discovery/skill-scanner.ts` | Scan `~/.claude/plugins/` for available skills and MCPs |
| `src/lib/discovery/__tests__/skill-scanner.test.ts` | Tests for scanner |
| `src/actions/discovery.ts` | Server action wrapping scanner with cache |
| `src/lib/orchestrator/asset-cli.ts` | `buildAssetCliArgs()` — translate asset config to CLI flags |
| `src/lib/orchestrator/__tests__/asset-cli.test.ts` | Tests for CLI arg builder |
| `src/app/(hq)/assets/[id]/page.tsx` | Asset detail page (server component) |
| `src/components/asset/asset-detail-tabs.tsx` | Tabbed detail UI (client component) |
| `src/components/asset/asset-profile-tab.tsx` | Profile editing tab |
| `src/components/asset/asset-prompt-tab.tsx` | System prompt editing tab |
| `src/components/asset/asset-skills-tab.tsx` | Skills & MCPs toggle tab |
| `src/components/asset/skill-toggle-list.tsx` | Reusable skill/MCP toggle list |
| `src/components/campaign/mission-skill-panel.tsx` | Per-mission skill override side panel |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | New columns on assets (`skills`, `mcpServers`, `maxTurns`, `effort`, `isSystem`) and missions (`skillOverrides`) |
| `src/types/index.ts` | New types: `DiscoveredSkill`, `DiscoveredMcp`, `SkillOverrides`, `AssetEffort` |
| `scripts/seed.ts` | Replace old asset roster with new 8-asset roster, add seed system prompts |
| `src/actions/asset.ts` | CRUD for new columns, system asset protections |
| `src/lib/orchestrator/executor.ts` | Use `buildAssetCliArgs()`, remove inline system prompt injection |
| `src/lib/orchestrator/prompt-builder.ts` | Remove asset system prompt from prompt text |
| `src/lib/overseer/debrief-reviewer.ts` | Load OVERSEER asset, use `buildAssetCliArgs()` |
| `src/lib/overseer/overseer.ts` | Load OVERSEER asset, use `buildAssetCliArgs()` |
| `src/lib/overseer/phase-failure-handler.ts` | Load OVERSEER asset, use `buildAssetCliArgs()` |
| `src/lib/orchestrator/campaign-executor.ts` | Load OVERSEER asset for debriefs |
| `src/lib/quartermaster/conflict-resolver.ts` | Load QUARTERMASTER asset, use `buildAssetCliArgs()` |
| `src/lib/briefing/briefing-engine.ts` | Load GENERAL asset, use `buildAssetCliArgs()` |
| `src/app/(hq)/assets/page.tsx` | Two-section layout (mission + system) |
| `src/components/asset/asset-list.tsx` | Support `isSystem` badge, link to detail page |
| `src/components/campaign/mission-card.tsx` | Asset badge click → skill panel |

---

### Task 1: Schema Migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/types/index.ts`
- Create: `src/lib/db/migrations/0013_*.sql` (auto-generated)

- [ ] **Step 1: Add new columns to assets table**

In `src/lib/db/schema.ts`, add after `missionsCompleted`:

```typescript
  skills: text('skills'),
  mcpServers: text('mcp_servers'),
  maxTurns: integer('max_turns'),
  effort: text('effort'),
  isSystem: integer('is_system').default(0),
```

- [ ] **Step 2: Add skillOverrides to missions table**

In `src/lib/db/schema.ts`, add after `mergeRetryAt` in the missions table:

```typescript
  skillOverrides: text('skill_overrides'),
```

- [ ] **Step 3: Add types**

In `src/types/index.ts`:

```typescript
export type AssetEffort = 'low' | 'medium' | 'high' | 'max';

export interface SkillOverrides {
  added?: string[];
  removed?: string[];
}

export interface DiscoveredSkill {
  id: string;
  name: string;
  pluginName: string;
  description: string;
  pluginDir: string;
}

export interface DiscoveredMcp {
  id: string;
  name: string;
  command: string;
  args: string[];
  source: string;
}
```

- [ ] **Step 4: Generate and review migration**

Run: `pnpm db:generate`

If the generator fails interactively, manually write `src/lib/db/migrations/0013_asset_skills.sql`:

```sql
ALTER TABLE `assets` ADD `skills` text;
ALTER TABLE `assets` ADD `mcp_servers` text;
ALTER TABLE `assets` ADD `max_turns` integer;
ALTER TABLE `assets` ADD `effort` text;
ALTER TABLE `assets` ADD `is_system` integer DEFAULT 0;
ALTER TABLE `missions` ADD `skill_overrides` text;
```

Update `meta/_journal.json` and create the snapshot JSON accordingly.

- [ ] **Step 5: Update schedule test hardcoded SQL if needed**

Check `src/actions/__tests__/schedule.test.ts` — if it has hardcoded CREATE TABLE for assets, add the new columns.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/types/index.ts src/lib/db/migrations/
git commit -m "feat: schema migration — asset skills, MCPs, effort, isSystem columns"
```

---

### Task 2: Asset Seed Overhaul

**Files:**
- Modify: `scripts/seed.ts`
- Modify: `src/actions/asset.ts`

- [ ] **Step 1: Rewrite seed.ts with new 8-asset roster**

Replace the current 6-asset seed with 8 assets. Each asset gets a seed system prompt.

```typescript
import { ulid } from 'ulid';
import { eq, count } from 'drizzle-orm';
import { getDatabase } from '../src/lib/db/index';
import { assets, battlefields, dossiers } from '../src/lib/db/schema';

const SEED_ASSETS = [
  {
    codename: 'OPERATIVE',
    specialty: 'Backend / general code',
    model: 'claude-sonnet-4-6',
    isSystem: 0,
    maxTurns: 100,
    systemPrompt: `You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.

RULES OF ENGAGEMENT:
1. MISSION SCOPE IS ABSOLUTE. Execute exactly what the briefing describes. Nothing more. Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice. If it is not in the briefing, it does not exist.
2. REPORT, DON'T FIX. If you encounter issues outside your scope, log them in your debrief under "Recommended Next Actions." The Commander decides follow-ups.
3. SPEED AND PRECISION. Minimal file reads — only what you need. Surgical edits — only the lines that matter.
4. COMMIT DISCIPLINE. Commit with clear, descriptive messages. Only commit files related to your mission.
5. DEBRIEF IS MANDATORY. On completion, provide a debrief to the Commander:
   - What was done (precise changes)
   - What changed (files modified)
   - Risks (anything that could break)
   - ## Recommended Next Actions (bullet list of follow-up tasks)

You are a general-purpose engineer. Backend, infrastructure, APIs, data layer — you handle whatever the mission requires.`,
  },
  {
    codename: 'VANGUARD',
    specialty: 'Frontend engineering',
    model: 'claude-sonnet-4-6',
    isSystem: 0,
    maxTurns: 100,
    skills: JSON.stringify(['frontend-design@claude-plugins-official']),
    systemPrompt: `You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.

RULES OF ENGAGEMENT:
1. MISSION SCOPE IS ABSOLUTE. Execute exactly what the briefing describes. Nothing more. Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice. If it is not in the briefing, it does not exist.
2. REPORT, DON'T FIX. If you encounter issues outside your scope, log them in your debrief under "Recommended Next Actions." The Commander decides follow-ups.
3. SPEED AND PRECISION. Minimal file reads — only what you need. Surgical edits — only the lines that matter.
4. COMMIT DISCIPLINE. Commit with clear, descriptive messages. Only commit files related to your mission.
5. DEBRIEF IS MANDATORY. On completion, provide a debrief to the Commander:
   - What was done (precise changes)
   - What changed (files modified)
   - Risks (anything that could break)
   - ## Recommended Next Actions (bullet list of follow-up tasks)

You specialize in frontend engineering — components, layouts, styling, client-side interactivity. Prioritize visual fidelity, accessibility, and responsive behavior.`,
  },
  {
    codename: 'ARCHITECT',
    specialty: 'System design, refactoring',
    model: 'claude-sonnet-4-6',
    isSystem: 0,
    maxTurns: 100,
    systemPrompt: `You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.

RULES OF ENGAGEMENT:
1. MISSION SCOPE IS ABSOLUTE. Execute exactly what the briefing describes. Nothing more. Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice. If it is not in the briefing, it does not exist.
2. REPORT, DON'T FIX. If you encounter issues outside your scope, log them in your debrief under "Recommended Next Actions." The Commander decides follow-ups.
3. SPEED AND PRECISION. Minimal file reads — only what you need. Surgical edits — only the lines that matter.
4. COMMIT DISCIPLINE. Commit with clear, descriptive messages. Only commit files related to your mission.
5. DEBRIEF IS MANDATORY. On completion, provide a debrief to the Commander:
   - What was done (precise changes)
   - What changed (files modified)
   - Risks (anything that could break)
   - ## Recommended Next Actions (bullet list of follow-up tasks)

You specialize in system design and structural improvements. Focus on clean boundaries, clear interfaces, and sustainable patterns. When refactoring, preserve all existing behavior.`,
  },
  {
    codename: 'ASSERT',
    specialty: 'Testing & QA',
    model: 'claude-sonnet-4-6',
    isSystem: 0,
    maxTurns: 100,
    systemPrompt: `You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.

RULES OF ENGAGEMENT:
1. MISSION SCOPE IS ABSOLUTE. Execute exactly what the briefing describes. Nothing more. Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice. If it is not in the briefing, it does not exist.
2. REPORT, DON'T FIX. If you encounter issues outside your scope, log them in your debrief under "Recommended Next Actions." The Commander decides follow-ups.
3. SPEED AND PRECISION. Minimal file reads — only what you need. Surgical edits — only the lines that matter.
4. COMMIT DISCIPLINE. Commit with clear, descriptive messages. Only commit files related to your mission.
5. DEBRIEF IS MANDATORY. On completion, provide a debrief to the Commander:
   - What was done (precise changes)
   - What changed (files modified)
   - Risks (anything that could break)
   - ## Recommended Next Actions (bullet list of follow-up tasks)

You specialize in testing and quality assurance. Write tests that verify behavior, not implementation details. Cover edge cases. If the codebase has test conventions, follow them.`,
  },
  {
    codename: 'INTEL',
    specialty: 'Docs, bootstrap, project intelligence',
    model: 'claude-sonnet-4-6',
    isSystem: 0,
    maxTurns: 100,
    systemPrompt: `You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.

RULES OF ENGAGEMENT:
1. MISSION SCOPE IS ABSOLUTE. Execute exactly what the briefing describes. Nothing more. Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice. If it is not in the briefing, it does not exist.
2. REPORT, DON'T FIX. If you encounter issues outside your scope, log them in your debrief under "Recommended Next Actions." The Commander decides follow-ups.
3. SPEED AND PRECISION. Minimal file reads — only what you need. Surgical edits — only the lines that matter.
4. COMMIT DISCIPLINE. Commit with clear, descriptive messages. Only commit files related to your mission.
5. DEBRIEF IS MANDATORY. On completion, provide a debrief to the Commander:
   - What was done (precise changes)
   - What changed (files modified)
   - Risks (anything that could break)
   - ## Recommended Next Actions (bullet list of follow-up tasks)

You specialize in project intelligence — documentation, specifications, and codebase analysis. Produce documents that are thorough, precise, and specific to the actual codebase. Your output is the authoritative reference for all other agents.`,
  },
  {
    codename: 'GENERAL',
    specialty: 'Campaign planning',
    model: 'claude-opus-4-6',
    isSystem: 1,
    maxTurns: 3,
    systemPrompt: `You are GENERAL, a campaign planning and coordination specialist for NYHZ OPS DEVROOM.

Your role is to work with the Commander to design campaign plans — phased operations with concrete missions assigned to specialist assets.

CONDUCT:
- This is a conversation. Respond, then STOP and WAIT for the Commander's reply.
- Do NOT use tools or explore the codebase unless explicitly asked.
- Ask clarifying questions to deeply understand the objective (2-3 per turn max).
- Discuss technical approach, risks, and trade-offs before committing to a plan.
- Consider inter-mission dependencies — what must complete before what.
- Assign assets by specialty: VANGUARD for frontend, OPERATIVE for backend, ARCHITECT for structural work, ASSERT for testing, INTEL for documentation.
- Keep each response concise and focused.

When the Commander says "GENERATE PLAN", output the final plan as JSON conforming to the PlanJSON schema.

PLAN RULES:
- Phases execute SEQUENTIALLY (Phase 1 completes before Phase 2 starts).
- Missions within a phase execute IN PARALLEL unless constrained by dependsOn.
- dependsOn references mission titles within the SAME phase only.
- Each mission briefing must be self-contained — the asset has NO context beyond what you write.`,
  },
  {
    codename: 'OVERSEER',
    specialty: 'Review & evaluation',
    model: 'claude-sonnet-4-6',
    isSystem: 1,
    maxTurns: 5,
    systemPrompt: `You are the OVERSEER of DEVROOM operations, serving under the Commander.

Your role is to evaluate agent work, make tactical decisions about mission quality, and maintain operational standards across all campaigns.

CONDUCT:
- Be decisive. Never hedge or ask for more information.
- Align decisions with project conventions (CLAUDE.md) and mission objectives.
- Choose the simplest approach that satisfies requirements.
- Most agent work is satisfactory. Only flag genuine issues — not style preferences.
- "retry" only when the agent clearly failed to complete the task.
- "escalate" only when there is significant risk the Commander should know about.
- If genuinely uncertain between two valid approaches, escalate.
- Keep responses concise — agents and campaigns are waiting on your judgment.
- Log reasoning clearly — the Commander reviews your decisions.`,
  },
  {
    codename: 'QUARTERMASTER',
    specialty: 'Merge & integration',
    model: 'claude-sonnet-4-6',
    isSystem: 1,
    maxTurns: 20,
    systemPrompt: `You are the QUARTERMASTER of DEVROOM operations.

Your role is to integrate completed mission work into the main codebase by resolving merge conflicts. You receive the mission context (what was built and why) along with the conflict details and upstream changes.

CONDUCT:
- Analyze both sides of each conflict carefully.
- Resolve preserving both intents — the mission's new work and upstream changes should coexist.
- If intents are truly incompatible, prefer the mission's work (source branch). Note what was lost.
- Run tests if a test command is available.
- Commit with message: "Merge [branch]: resolve conflicts"
- Report what you resolved and any risks.`,
  },
];

export function seedIfEmpty() {
  const db = getDatabase();

  // Seed assets — insert missing ones by codename, never overwrite existing
  for (const seed of SEED_ASSETS) {
    const existing = db.select().from(assets).where(eq(assets.codename, seed.codename)).get();
    if (!existing) {
      db.insert(assets).values({
        id: ulid(),
        codename: seed.codename,
        specialty: seed.specialty,
        systemPrompt: seed.systemPrompt,
        model: seed.model,
        isSystem: seed.isSystem,
        maxTurns: seed.maxTurns,
        skills: seed.skills ?? null,
        status: 'active',
        createdAt: Date.now(),
      }).run();
      console.log(`Seeded asset: ${seed.codename}`);
    }
  }

  // ... keep existing battlefield and dossier seeding unchanged ...
}
```

- [ ] **Step 2: Update asset actions with system protections**

In `src/actions/asset.ts`:

- `deleteAsset()` — add guard: `if (asset.isSystem) throw new Error('Cannot delete system assets')`
- `toggleAssetStatus()` — add guard: `if (asset.isSystem) throw new Error('Cannot toggle system asset status')`
- `updateAsset()` — if `isSystem`, don't allow codename changes

- [ ] **Step 3: Update PATHFINDER references to INTEL**

Search for any code that looks up `PATHFINDER` by codename (e.g., `createBootstrapMission` in `battlefield.ts`) and update to `INTEL`.

- [ ] **Step 4: Run tests**

Run: `pnpm test --run`

Fix any failures from the PATHFINDER → INTEL rename or new schema columns in test fixtures.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts src/actions/asset.ts src/actions/battlefield.ts
git commit -m "feat: overhaul asset roster — 8 assets with seed prompts, system protections"
```

---

### Task 3: Skill & MCP Discovery Scanner

**Files:**
- Create: `src/lib/discovery/skill-scanner.ts`
- Create: `src/lib/discovery/__tests__/skill-scanner.test.ts`
- Create: `src/actions/discovery.ts`

- [ ] **Step 1: Write failing tests for scanner**

Create `src/lib/discovery/__tests__/skill-scanner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');

describe('scanHostSkills', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty arrays when plugins directory does not exist', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { scanHostSkills } = await import('@/lib/discovery/skill-scanner');
    const result = scanHostSkills();

    expect(result.skills).toEqual([]);
    expect(result.mcpServers).toEqual([]);
  });

  it('discovers skills from installed plugins manifest', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.includes('installed_plugins.json')) {
        return JSON.stringify({
          'frontend-design@claude-plugins-official': {
            name: 'frontend-design',
            version: '1.0.0',
            enabled: true,
          },
        });
      }
      if (path.includes('package.json')) {
        return JSON.stringify({
          name: 'frontend-design',
          description: 'Create distinctive frontend interfaces',
          skills: [{ name: 'frontend-design', description: 'Frontend design skill' }],
        });
      }
      return '{}';
    });
    (fs.readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const { scanHostSkills } = await import('@/lib/discovery/skill-scanner');
    const result = scanHostSkills();

    expect(result.skills.length).toBeGreaterThan(0);
    expect(result.skills[0].id).toContain('frontend-design');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --run src/lib/discovery/__tests__/skill-scanner.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement scanner**

Create `src/lib/discovery/skill-scanner.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { DiscoveredSkill, DiscoveredMcp } from '@/types';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PLUGINS_DIR = path.join(CLAUDE_DIR, 'plugins');
const CACHE_DIR = path.join(PLUGINS_DIR, 'cache');
const MANIFEST_PATH = path.join(PLUGINS_DIR, 'installed_plugins.json');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');

interface PluginManifestEntry {
  name: string;
  version: string;
  enabled: boolean;
}

interface ScanResult {
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcp[];
}

export function scanHostSkills(): ScanResult {
  const skills: DiscoveredSkill[] = [];
  const mcpServers: DiscoveredMcp[] = [];

  if (!fs.existsSync(PLUGINS_DIR)) {
    return { skills, mcpServers };
  }

  // Read plugin manifest
  let manifest: Record<string, PluginManifestEntry> = {};
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    manifest = JSON.parse(raw);
  } catch {
    return { skills, mcpServers };
  }

  for (const [pluginKey, entry] of Object.entries(manifest)) {
    if (!entry.enabled) continue;

    // Parse plugin key: "skill-name@publisher"
    const [, publisher] = pluginKey.split('@');
    const pluginCacheDir = path.join(CACHE_DIR, publisher || 'local', entry.name);

    // Find the versioned directory
    let versionedDir = pluginCacheDir;
    try {
      const versions = fs.readdirSync(pluginCacheDir).filter(d =>
        fs.statSync(path.join(pluginCacheDir, d)).isDirectory()
      );
      if (versions.length > 0) {
        // Use the latest version directory
        versionedDir = path.join(pluginCacheDir, versions.sort().reverse()[0]);
      }
    } catch { /* use base dir */ }

    // Discover skills from plugin
    try {
      const skillsDir = path.join(versionedDir, 'skills');
      if (fs.existsSync(skillsDir)) {
        const skillFiles = fs.readdirSync(skillsDir).filter(f =>
          f.endsWith('.md') || fs.statSync(path.join(skillsDir, f)).isDirectory()
        );

        for (const skillFile of skillFiles) {
          const skillName = skillFile.replace('.md', '');
          const skillPath = path.join(skillsDir, skillFile);

          // Read frontmatter for description
          let description = '';
          try {
            const content = fs.readFileSync(
              fs.statSync(skillPath).isDirectory()
                ? path.join(skillPath, `${skillName}.md`)
                : skillPath,
              'utf-8',
            );
            const descMatch = content.match(/description:\s*(.+)/);
            if (descMatch) description = descMatch[1].trim();
          } catch { /* skip */ }

          skills.push({
            id: `${skillName}@${publisher || 'local'}`,
            name: skillName,
            pluginName: publisher || 'local',
            description,
            pluginDir: versionedDir,
          });
        }
      }
    } catch { /* skip plugin */ }

    // Discover MCP servers from plugin config
    try {
      const configPath = path.join(versionedDir, 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.mcpServers) {
          for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
            const sc = serverConfig as { command: string; args?: string[] };
            mcpServers.push({
              id: serverName,
              name: serverName,
              command: sc.command,
              args: sc.args || [],
              source: pluginKey,
            });
          }
        }
      }
    } catch { /* skip */ }
  }

  // Also check user-level MCP servers in settings.json
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      if (settings.mcpServers) {
        for (const [serverName, serverConfig] of Object.entries(settings.mcpServers)) {
          const sc = serverConfig as { command: string; args?: string[] };
          // Don't duplicate if already found via plugins
          if (!mcpServers.some(m => m.id === serverName)) {
            mcpServers.push({
              id: serverName,
              name: serverName,
              command: sc.command,
              args: sc.args || [],
              source: 'user-settings',
            });
          }
        }
      }
    }
  } catch { /* skip */ }

  return { skills, mcpServers };
}
```

- [ ] **Step 4: Create cached server action**

Create `src/actions/discovery.ts`:

```typescript
'use server';

import { scanHostSkills } from '@/lib/discovery/skill-scanner';
import type { DiscoveredSkill, DiscoveredMcp } from '@/types';

interface DiscoveryCache {
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcp[];
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cache: DiscoveryCache | null = null;

export async function getAvailableSkillsAndMcps(): Promise<DiscoveryCache> {
  const now = Date.now();
  if (cache && (now - cache.cachedAt) < CACHE_TTL_MS) {
    return cache;
  }

  const result = scanHostSkills();
  cache = { ...result, cachedAt: now };
  return cache;
}

export async function refreshDiscoveryCache(): Promise<DiscoveryCache> {
  cache = null;
  return getAvailableSkillsAndMcps();
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test --run src/lib/discovery/`

Expected: Tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/discovery/ src/actions/discovery.ts
git commit -m "feat: skill and MCP discovery scanner with cached server action"
```

---

### Task 4: Build Asset CLI Args Utility

**Files:**
- Create: `src/lib/orchestrator/asset-cli.ts`
- Create: `src/lib/orchestrator/__tests__/asset-cli.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/orchestrator/__tests__/asset-cli.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';
import type { Asset } from '@/types';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'test-id',
    codename: 'OPERATIVE',
    specialty: 'general',
    systemPrompt: null,
    model: 'claude-sonnet-4-6',
    status: 'active',
    missionsCompleted: 0,
    skills: null,
    mcpServers: null,
    maxTurns: null,
    effort: null,
    isSystem: 0,
    createdAt: Date.now(),
    ...overrides,
  } as Asset;
}

describe('buildAssetCliArgs', () => {
  it('returns model flag when set', () => {
    const args = buildAssetCliArgs(makeAsset({ model: 'claude-opus-4-6' }));
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-4-6');
  });

  it('returns max-turns flag when set', () => {
    const args = buildAssetCliArgs(makeAsset({ maxTurns: 50 }));
    expect(args).toContain('--max-turns');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('50');
  });

  it('returns effort flag when set', () => {
    const args = buildAssetCliArgs(makeAsset({ effort: 'high' }));
    expect(args).toContain('--effort');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });

  it('returns append-system-prompt when systemPrompt is set', () => {
    const args = buildAssetCliArgs(makeAsset({ systemPrompt: 'You are a specialist.' }));
    expect(args).toContain('--append-system-prompt');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('You are a specialist.');
  });

  it('omits flags when values are null', () => {
    const args = buildAssetCliArgs(makeAsset({
      model: null, maxTurns: null, effort: null, systemPrompt: null,
    }));
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--max-turns');
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('--append-system-prompt');
  });

  it('resolves skills to plugin-dir flags', () => {
    const args = buildAssetCliArgs(makeAsset({
      skills: JSON.stringify(['frontend-design@claude-plugins-official']),
    }));
    const pluginDirIndices = args.reduce((acc: number[], arg, i) =>
      arg === '--plugin-dir' ? [...acc, i] : acc, []);
    expect(pluginDirIndices.length).toBe(1);
  });

  it('applies skill overrides — removes default, adds new', () => {
    const args = buildAssetCliArgs(
      makeAsset({ skills: JSON.stringify(['skill-a@pub', 'skill-b@pub']) }),
      { removed: ['skill-a@pub'], added: ['skill-c@pub'] },
    );
    const pluginDirs = args.reduce((acc: string[], arg, i) =>
      arg === '--plugin-dir' ? [...acc, args[i + 1]] : acc, []);
    // skill-a removed, skill-b kept, skill-c added = 2 plugin dirs
    expect(pluginDirs.length).toBe(2);
  });

  it('returns mcp-config flag when mcpServers is set', () => {
    const mcpConfig = { telegram: { command: 'bun', args: ['run', 'start'] } };
    const args = buildAssetCliArgs(makeAsset({ mcpServers: JSON.stringify(mcpConfig) }));
    expect(args).toContain('--mcp-config');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --run src/lib/orchestrator/__tests__/asset-cli.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement buildAssetCliArgs**

Create `src/lib/orchestrator/asset-cli.ts`:

```typescript
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { Asset, SkillOverrides } from '@/types';

const CACHE_DIR = path.join(os.homedir(), '.claude', 'plugins', 'cache');

/**
 * Resolve a skill ID (e.g., "frontend-design@claude-plugins-official") to its
 * plugin directory path on disk.
 */
function resolvePluginDir(skillId: string): string | null {
  const [skillName, publisher] = skillId.split('@');
  if (!publisher) return null;

  const pluginDir = path.join(CACHE_DIR, publisher, skillName);
  if (!fs.existsSync(pluginDir)) return null;

  // Find the latest versioned directory
  try {
    const versions = fs.readdirSync(pluginDir).filter(d =>
      fs.statSync(path.join(pluginDir, d)).isDirectory()
    );
    if (versions.length > 0) {
      return path.join(pluginDir, versions.sort().reverse()[0]);
    }
  } catch { /* fall through */ }

  return pluginDir;
}

/**
 * Translate asset configuration + optional per-mission overrides into
 * Claude Code CLI arguments.
 */
export function buildAssetCliArgs(
  asset: Asset,
  skillOverrides?: SkillOverrides | null,
): string[] {
  const args: string[] = [];

  // Model
  if (asset.model) {
    args.push('--model', asset.model);
  }

  // Max turns
  if (asset.maxTurns != null) {
    args.push('--max-turns', String(asset.maxTurns));
  }

  // Effort
  if (asset.effort) {
    args.push('--effort', asset.effort);
  }

  // System prompt
  if (asset.systemPrompt) {
    args.push('--append-system-prompt', asset.systemPrompt);
  }

  // Skills → --plugin-dir flags
  let resolvedSkills: string[] = [];
  try {
    resolvedSkills = asset.skills ? JSON.parse(asset.skills) : [];
  } catch { resolvedSkills = []; }

  if (skillOverrides) {
    if (skillOverrides.removed) {
      resolvedSkills = resolvedSkills.filter(s => !skillOverrides.removed!.includes(s));
    }
    if (skillOverrides.added) {
      for (const s of skillOverrides.added) {
        if (!resolvedSkills.includes(s)) resolvedSkills.push(s);
      }
    }
  }

  for (const skillId of resolvedSkills) {
    const dir = resolvePluginDir(skillId);
    if (dir) args.push('--plugin-dir', dir);
  }

  // MCP servers
  if (asset.mcpServers) {
    try {
      const parsed = JSON.parse(asset.mcpServers);
      if (Object.keys(parsed).length > 0) {
        args.push('--mcp-config', asset.mcpServers);
      }
    } catch { /* skip invalid */ }
  }

  return args;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run src/lib/orchestrator/__tests__/asset-cli.test.ts`

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/orchestrator/asset-cli.ts src/lib/orchestrator/__tests__/asset-cli.test.ts
git commit -m "feat: buildAssetCliArgs utility — translate asset config to CLI flags"
```

---

### Task 5: Wire All Spawn Points to Asset Config

**Files:**
- Modify: `src/lib/orchestrator/executor.ts`
- Modify: `src/lib/orchestrator/prompt-builder.ts`
- Modify: `src/lib/overseer/debrief-reviewer.ts`
- Modify: `src/lib/overseer/overseer.ts`
- Modify: `src/lib/overseer/phase-failure-handler.ts`
- Modify: `src/lib/orchestrator/campaign-executor.ts`
- Modify: `src/lib/quartermaster/conflict-resolver.ts`
- Modify: `src/lib/briefing/briefing-engine.ts`

- [ ] **Step 1: Create getSystemAsset helper**

Add to `src/actions/asset.ts`:

```typescript
/** Cache for system asset lookups — avoids repeated DB queries */
const systemAssetCache = new Map<string, { asset: Asset; cachedAt: number }>();
const SYSTEM_ASSET_CACHE_TTL = 60_000; // 1 minute

export function getSystemAsset(codename: string): Asset {
  const now = Date.now();
  const cached = systemAssetCache.get(codename);
  if (cached && (now - cached.cachedAt) < SYSTEM_ASSET_CACHE_TTL) {
    return cached.asset;
  }

  const db = getDatabase();
  const asset = db.select().from(assets)
    .where(eq(assets.codename, codename)).get();
  if (!asset) {
    throw new Error(`System asset ${codename} not found. Run seed.`);
  }

  systemAssetCache.set(codename, { asset, cachedAt: now });
  return asset;
}
```

- [ ] **Step 2: Update executor.ts — use buildAssetCliArgs**

In `src/lib/orchestrator/executor.ts`:

- Import `buildAssetCliArgs` from `./asset-cli`
- Where CLI args are built (around line 264), replace hardcoded flags with:

```typescript
import { buildAssetCliArgs } from './asset-cli';

// Load asset
const asset = mission.assetId
  ? db.select().from(assets).where(eq(assets.id, mission.assetId)).get()
  : null;

// Parse skill overrides from mission
const skillOverrides = mission.skillOverrides
  ? JSON.parse(mission.skillOverrides)
  : null;

// Base args
const args = [
  '--print', '--verbose', '--output-format', 'stream-json',
  '--include-partial-messages', '--dangerously-skip-permissions',
];

// Asset-specific args (model, max-turns, effort, system prompt, skills, MCPs)
if (asset) {
  args.push(...buildAssetCliArgs(asset, skillOverrides));
} else {
  args.push('--max-turns', '100');
}

// Prompt as positional argument (no longer includes asset system prompt)
args.push(prompt);
```

- [ ] **Step 3: Update prompt-builder.ts — remove asset system prompt injection**

In `src/lib/orchestrator/prompt-builder.ts`, find where `asset?.systemPrompt` is injected into the prompt text and **remove it**. The system prompt now goes via `--append-system-prompt` from `buildAssetCliArgs()`.

Remove these lines (approximately):
```typescript
// 2. Asset system prompt
if (asset?.systemPrompt) {
  sections.push(asset.systemPrompt);
}
```

Also remove the "Operational Parameters" section from the prompt builder — it's now part of the asset's system prompt in the DB.

- [ ] **Step 4: Update debrief-reviewer.ts — load OVERSEER asset**

In `src/lib/overseer/debrief-reviewer.ts`:

```typescript
import { getSystemAsset } from '@/actions/asset';
import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';

function spawnReview(prompt: string): Promise<string> {
  const overseer = getSystemAsset('OVERSEER');
  const assetArgs = buildAssetCliArgs(overseer);

  return runClaudePrint(prompt, {
    maxTurns: 2, // Override asset default for review
    outputFormat: 'json',
    jsonSchema: REVIEW_JSON_SCHEMA,
    extraArgs: assetArgs,
  });
}
```

Note: `runClaudePrint` needs to accept an `extraArgs` option. Check if it does; if not, add it — it should pass the extra args to the Claude CLI spawn.

- [ ] **Step 5: Update overseer.ts (stall detection) — load OVERSEER asset**

Same pattern — load OVERSEER asset, build CLI args, pass to spawn. Override `maxTurns: 1` for stall detection.

- [ ] **Step 6: Update phase-failure-handler.ts — load OVERSEER asset**

Same pattern — override `maxTurns: 1`.

- [ ] **Step 7: Update campaign-executor.ts — load OVERSEER for debriefs**

For `generatePhaseDebrief()` and `generateCampaignDebrief()` — load OVERSEER asset, build CLI args, override `maxTurns: 5`.

- [ ] **Step 8: Update conflict-resolver.ts — load QUARTERMASTER asset**

Load QUARTERMASTER asset, build CLI args. The `maxTurns: 20` comes from the asset default.

- [ ] **Step 9: Update briefing-engine.ts — load GENERAL asset**

Load GENERAL asset, build CLI args. Replace the current hardcoded model lookup with `buildAssetCliArgs()`.

- [ ] **Step 10: Update runClaudePrint to accept extraArgs**

In `src/lib/process/claude-print.ts`, add an `extraArgs?: string[]` option to the options parameter. Append them to the CLI args array before spawning.

- [ ] **Step 11: Run tests**

Run: `pnpm test --run`

Fix any failures. The key risk is prompt-builder tests that expect the system prompt in the output.

- [ ] **Step 12: Commit**

```bash
git add src/lib/orchestrator/ src/lib/overseer/ src/lib/quartermaster/ src/lib/briefing/ src/lib/process/ src/actions/asset.ts
git commit -m "feat: wire all spawn points to asset config via buildAssetCliArgs"
```

---

### Task 6: Assets List Page — Two Sections

**Files:**
- Modify: `src/app/(hq)/assets/page.tsx`
- Modify: `src/components/asset/asset-list.tsx`

- [ ] **Step 1: Update assets page to split into two sections**

In `src/app/(hq)/assets/page.tsx`:

```tsx
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { AssetList } from '@/components/asset/asset-list';

export default function AssetsPage() {
  const db = getDatabase();
  const allAssets = db.select().from(assets).all();

  const missionAssets = allAssets.filter(a => !a.isSystem);
  const systemAssets = allAssets.filter(a => a.isSystem);

  return (
    <div className="space-y-8">
      <AssetList title="MISSION ASSETS" assets={missionAssets} showSystemBadge={false} />
      <AssetList title="SYSTEM ASSETS" assets={systemAssets} showSystemBadge={true} />
    </div>
  );
}
```

- [ ] **Step 2: Update AssetList component**

In `src/components/asset/asset-list.tsx`:

- Accept `showSystemBadge` prop
- Each card links to `/assets/${asset.id}` (the detail page from Task 7)
- Show "SYSTEM" badge when `showSystemBadge && asset.isSystem`
- Show skill count: `JSON.parse(asset.skills || '[]').length` active skills
- Disable delete/toggle for system assets

- [ ] **Step 3: Run tests**

Run: `pnpm test --run`

- [ ] **Step 4: Commit**

```bash
git add src/app/(hq)/assets/page.tsx src/components/asset/asset-list.tsx
git commit -m "feat: assets page — two sections for mission and system assets"
```

---

### Task 7: Asset Detail Page

**Files:**
- Create: `src/app/(hq)/assets/[id]/page.tsx`
- Create: `src/components/asset/asset-detail-tabs.tsx`
- Create: `src/components/asset/asset-profile-tab.tsx`
- Create: `src/components/asset/asset-prompt-tab.tsx`
- Create: `src/components/asset/asset-skills-tab.tsx`
- Create: `src/components/asset/skill-toggle-list.tsx`

- [ ] **Step 1: Create server component page**

Create `src/app/(hq)/assets/[id]/page.tsx`:

```tsx
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { AssetDetailTabs } from '@/components/asset/asset-detail-tabs';
import { getAvailableSkillsAndMcps } from '@/actions/discovery';

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDatabase();
  const asset = db.select().from(assets).where(eq(assets.id, id)).get();

  if (!asset) notFound();

  const discovery = await getAvailableSkillsAndMcps();

  return (
    <div className="p-6">
      <h1 className="font-mono text-lg text-tac-green mb-6">
        {asset.codename}
        {asset.isSystem ? (
          <span className="ml-2 text-xs px-2 py-0.5 bg-tac-amber/20 text-tac-amber border border-tac-amber/30 rounded font-mono uppercase">
            System
          </span>
        ) : null}
      </h1>
      <AssetDetailTabs asset={asset} discovery={discovery} />
    </div>
  );
}
```

- [ ] **Step 2: Create AssetDetailTabs client component**

Create `src/components/asset/asset-detail-tabs.tsx` — a client component with three tabs (Profile, System Prompt, Skills & MCPs). Use a simple tab state with buttons. Each tab renders its own sub-component.

- [ ] **Step 3: Create AssetProfileTab**

Create `src/components/asset/asset-profile-tab.tsx` — form with fields for specialty, model (dropdown), effort (dropdown), max turns (number), status toggle. Calls `updateAsset()` server action on save. System assets have codename read-only and status toggle disabled.

- [ ] **Step 4: Create AssetPromptTab**

Create `src/components/asset/asset-prompt-tab.tsx` — full-height monospace textarea for system prompt with character count and save button. Calls `updateAsset()` with `systemPrompt` field.

- [ ] **Step 5: Create SkillToggleList component**

Create `src/components/asset/skill-toggle-list.tsx` — reusable component that renders a list of items with toggle switches:

```tsx
interface ToggleItem {
  id: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
}

interface SkillToggleListProps {
  items: ToggleItem[];
  onToggle: (id: string, enabled: boolean) => void;
}
```

Each row: item name, source badge, description, toggle switch. Tactical styling — monospace, dim borders, green toggles.

- [ ] **Step 6: Create AssetSkillsTab**

Create `src/components/asset/asset-skills-tab.tsx` — uses `SkillToggleList` for both skills and MCPs. Maps discovered skills/MCPs to toggle items, marking enabled ones from the asset's `skills` and `mcpServers` JSON. On toggle, calls `updateAsset()` with updated JSON arrays.

Shows "Last scanned: X min ago" with a refresh button that calls `refreshDiscoveryCache()`.

- [ ] **Step 7: Update updateAsset action for new fields**

In `src/actions/asset.ts`, extend `updateAsset()` to accept and persist `skills`, `mcpServers`, `maxTurns`, `effort` fields.

- [ ] **Step 8: Run tests**

Run: `pnpm test --run`

- [ ] **Step 9: Commit**

```bash
git add src/app/(hq)/assets/[id]/ src/components/asset/ src/actions/asset.ts
git commit -m "feat: asset detail page with profile, system prompt, and skills tabs"
```

---

### Task 8: Campaign Planning — Mission Skill Override Panel

**Files:**
- Create: `src/components/campaign/mission-skill-panel.tsx`
- Modify: `src/components/campaign/mission-card.tsx`
- Modify: `src/actions/campaign.ts`

- [ ] **Step 1: Add server action for mission skill overrides**

In `src/actions/campaign.ts`:

```typescript
export async function updateMissionSkillOverrides(
  missionId: string,
  overrides: SkillOverrides | null,
): Promise<void> {
  const db = getDatabase();
  db.update(missions).set({
    skillOverrides: overrides ? JSON.stringify(overrides) : null,
    updatedAt: Date.now(),
  }).where(eq(missions.id, missionId)).run();

  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (mission?.battlefieldId) {
    revalidatePath(`/battlefields/${mission.battlefieldId}`);
  }
}
```

- [ ] **Step 2: Create MissionSkillPanel**

Create `src/components/campaign/mission-skill-panel.tsx`:

A side panel (slide-in or collapsible) that shows:
- Current asset assignment (with dropdown to change)
- Skills list using `SkillToggleList` — asset defaults pre-toggled with "(default)" label
- MCP list using `SkillToggleList`
- Changes call `updateMissionSkillOverrides()` immediately

```tsx
'use client';

import { useState, useEffect } from 'react';
import { SkillToggleList } from '@/components/asset/skill-toggle-list';
import { updateMissionSkillOverrides } from '@/actions/campaign';
import type { DiscoveredSkill, DiscoveredMcp, SkillOverrides, Asset } from '@/types';

interface MissionSkillPanelProps {
  missionId: string;
  asset: Asset;
  currentOverrides: SkillOverrides | null;
  discoveredSkills: DiscoveredSkill[];
  discoveredMcps: DiscoveredMcp[];
  onClose: () => void;
}
```

The panel computes the toggle state:
- Start with asset's default skills
- Apply overrides (added/removed)
- When user toggles, compute the diff against asset defaults and save as overrides

- [ ] **Step 3: Wire panel to mission card**

In `src/components/campaign/mission-card.tsx`:

- Add click handler on the asset badge
- When clicked in `planning` or `draft` campaign state, show `MissionSkillPanel`
- Pass the mission's asset, current overrides, and discovered skills/MCPs
- Only show the clickable badge when campaign status allows editing

- [ ] **Step 4: Run tests**

Run: `pnpm test --run`

- [ ] **Step 5: Commit**

```bash
git add src/components/campaign/ src/actions/campaign.ts
git commit -m "feat: per-mission skill override panel in campaign planning"
```

---

### Task 9: Final Integration & Verification

**Files:**
- Various

- [ ] **Step 1: Run full test suite**

Run: `pnpm test --run`

Fix any failures.

- [ ] **Step 2: Verify PATHFINDER → INTEL references**

```bash
grep -ri "PATHFINDER" src/ --include="*.ts" --include="*.tsx"
```

Should only appear in comments or old migration files. All code references should use INTEL.

- [ ] **Step 3: Verify WATCHDOG → OVERSEER references**

```bash
grep -ri "WATCHDOG" src/ --include="*.ts" --include="*.tsx"
```

Should be clean or only in seed data comments.

- [ ] **Step 4: Verify DISTILL → INTEL references**

```bash
grep -ri "DISTILL" src/ --include="*.ts" --include="*.tsx"
```

Should be clean.

- [ ] **Step 5: Verify all spawn points use buildAssetCliArgs**

```bash
grep -rn "runClaudePrint\|spawn.*claude" src/lib/ --include="*.ts"
```

Every spawn should go through `buildAssetCliArgs()` or have a clear comment why not.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: final integration — verify asset config wiring across all spawn points"
```

---

## Task Dependency Graph

```
Task 1 (Schema) ──────────────────────────────────────────────┐
  ├── Task 2 (Seed Overhaul) ─────────────────────────────────┤
  ├── Task 3 (Discovery Scanner) ─────────────────────────────┤
  ├── Task 4 (CLI Args Builder) ──────────────────────────────┤
  │     └── Task 5 (Wire All Spawn Points) ───────────────────┤
  ├── Task 6 (Assets List Page) ──────────────────────────────┤
  │     └── Task 7 (Asset Detail Page) ───────────────────────┤
  │           └── Task 8 (Mission Skill Panel) ───────────────┤
  └── Task 9 (Final Integration) ─────────────────────────────┘
```

**Critical path:** 1 → 4 → 5 → 9

**Parallelizable after Task 1:** Tasks 2, 3, 4, 6 can run concurrently.

**Parallelizable after Task 4:** Tasks 5 and 7 can run concurrently.
