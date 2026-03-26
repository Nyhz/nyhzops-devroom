# Phase B1: Battlefields + Mission CRUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the Commander to create battlefields (new or linked), deploy missions to the queue, browse and search missions, view mission details, and abandon missions — with scaffold commands streaming in real-time.

**Architecture:** Server Actions for all CRUD mutations. Route Handler for long-running scaffold command with Socket.IO streaming. Reusable command-runner utility for process spawning. All pages follow Next.js 16.2 App Router patterns with async params.

**Tech Stack:** Next.js 16.2 Server Actions, Drizzle ORM, Socket.IO, simple-git, child_process.spawn

**Spec:** `docs/superpowers/specs/2026-03-26-phase-b1-battlefields-missions-design.md`

---

## File Map

### New Files (by task)

**Task 1 — Schema Migration + Types:**
- `src/lib/db/migrations/` (new migration for scaffoldStatus column)
- `src/types/index.ts` (modified — add input/enriched types)

**Task 2 — Battlefield Server Actions:**
- `src/actions/battlefield.ts`

**Task 3 — Mission Server Actions:**
- `src/actions/mission.ts`

**Task 4 — Command Runner + Scaffold Route:**
- `src/lib/process/command-runner.ts`
- `src/app/api/battlefields/[id]/scaffold/route.ts`
- `src/app/api/battlefields/[id]/scaffold/logs/route.ts`

**Task 5 — Socket.IO Updates + Hooks:**
- `src/lib/socket/server.ts` (modified — add unsubscribe handlers)
- `src/hooks/use-command-output.ts`

**Task 6 — Battlefield Creation Form:**
- `src/app/projects/new/page.tsx`
- `src/components/battlefield/create-battlefield.tsx`
- `src/app/projects/page.tsx` (modified — add NEW BATTLEFIELD button)

**Task 7 — Quick Deploy Form + Dossier Loading:**
- `src/components/dashboard/deploy-mission.tsx`
- `src/app/projects/[id]/page.tsx` (modified — wire deploy form)

**Task 8 — Mission List + Stats Bar:**
- `src/components/dashboard/mission-list.tsx`
- `src/components/dashboard/stats-bar.tsx`
- `src/app/projects/[id]/page.tsx` (modified — wire real data)

**Task 9 — Mission Detail Page:**
- `src/app/projects/[id]/missions/[missionId]/page.tsx` (replaced)

**Task 10 — Scaffold Streaming UI:**
- `src/components/battlefield/scaffold-output.tsx`
- `src/app/projects/[id]/page.tsx` (modified — show scaffold when running)

**Task 11 — Integration Verification:**
- Various fixes, final commit

---

## Task 1: Schema Migration + Types

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/types/index.ts`
- Create: new migration in `src/lib/db/migrations/`

- [ ] **Step 1: Add scaffoldStatus column to battlefields schema**

In `src/lib/db/schema.ts`, add to the `battlefields` table:

```typescript
scaffoldStatus: text('scaffold_status'),  // null | 'running' | 'complete' | 'failed'
```

- [ ] **Step 2: Generate migration**

```bash
pnpm db:generate
```

Expected: New migration file in `src/lib/db/migrations/`.

- [ ] **Step 3: Verify migration applies**

```bash
pnpm db:migrate
```

Or start the dev server briefly — migrations run on startup.

- [ ] **Step 4: Add new types to src/types/index.ts**

Add all the input and enriched types from the spec:

```typescript
// Scaffold status
export type ScaffoldStatus = 'running' | 'complete' | 'failed';

// Input types for Server Actions
export interface CreateBattlefieldInput {
  name: string;
  codename: string;
  description?: string;
  initialBriefing?: string;
  scaffoldCommand?: string;
  defaultBranch?: string;
  repoPath?: string;  // provided only for "link existing repo" flow
}

export interface UpdateBattlefieldInput {
  name?: string;
  codename?: string;
  description?: string;
  initialBriefing?: string;
  devServerCommand?: string;
  autoStartDevServer?: boolean;
  defaultBranch?: string;
}

export interface CreateMissionInput {
  battlefieldId: string;
  briefing: string;
  title?: string;
  assetId?: string;
  priority?: MissionPriority;
}

export interface ListMissionsOptions {
  search?: string;
  status?: MissionStatus;
}

// Enriched types for UI
export interface BattlefieldWithCounts extends Battlefield {
  missionCount: number;
  campaignCount: number;
  activeMissionCount: number;
}

export interface MissionWithDetails extends Mission {
  assetCodename: string | null;
  assetSpecialty: string | null;
  battlefieldCodename: string;
  logCount: number;
}

// Command runner types
export interface RunCommandOptions {
  command: string;
  cwd: string;
  socketRoom?: string;
  battlefieldId?: string;  // for logging to commandLogs
  abortSignal?: AbortSignal;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/ src/types/index.ts
git commit -m "feat: add scaffoldStatus column and Phase B1 types"
```

---

## Task 2: Battlefield Server Actions

**Files:**
- Create: `src/actions/battlefield.ts`

- [ ] **Step 1: Create battlefield server actions file**

Create `src/actions/battlefield.ts` with `"use server"` directive. Implement all 5 actions:

**`createBattlefield`:**
1. If no `repoPath` (new project flow):
   - Compute path: `{config.devBasePath}/{toKebabCase(name)}`
   - Validate directory doesn't exist (`fs.existsSync`)
   - `mkdir -p` via `fs.mkdirSync({ recursive: true })`
   - `git init` via `simple-git`
   - If `scaffoldCommand`: set `scaffoldStatus = 'running'` on the record
2. If `repoPath` (link flow):
   - Validate path exists and has `.git` directory
   - Detect default branch via `simple-git`
3. Insert battlefield record with `generateId()`, `Date.now()` timestamps
4. `revalidatePath('/projects')` and `revalidatePath(/projects/${id})`
5. Return battlefield

**`getBattlefield`:**
- Query battlefield by ID
- Aggregate mission count, campaign count, active mission count via subqueries or separate counts
- Return `BattlefieldWithCounts`

**`listBattlefields`:**
- `db.select().from(battlefields).orderBy(desc(battlefields.updatedAt)).all()`

**`updateBattlefield`:**
- Update specified fields + `updatedAt = Date.now()`
- `revalidatePath`

**`deleteBattlefield`:**
- Transaction with FK-safe deletion order:
  1. Delete mission logs (for missions in this battlefield)
  2. Delete missions
  3. Delete phases (for campaigns in this battlefield)
  4. Delete campaigns
  5. Delete scheduled tasks
  6. Delete command logs
  7. Delete battlefield
- `revalidatePath('/projects')`

- [ ] **Step 2: Verify actions import correctly**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Smoke test createBattlefield**

Temporarily test by calling the action from a page or script. Verify:
- New project: directory created, git initialized, DB record exists
- Link existing: validates git repo, DB record created
- Clean up test data after.

- [ ] **Step 4: Commit**

```bash
git add src/actions/battlefield.ts
git commit -m "feat: add battlefield CRUD server actions"
```

---

## Task 3: Mission Server Actions

**Files:**
- Create: `src/actions/mission.ts`

- [ ] **Step 1: Create mission server actions file**

Create `src/actions/mission.ts` with `"use server"` directive. Implement all 5 actions:

**`createMission`:**
1. Auto-generate title if not provided: first line of briefing, strip `#` prefix, truncate to 80 chars
2. Insert with `generateId()`, status `standby`, timestamps
3. Emit `activity:event` to `hq:activity` Socket.IO room: `{ type: 'mission:created', battlefieldCodename, missionTitle, timestamp, detail: 'Status: STANDBY' }`
4. `revalidatePath(/projects/${battlefieldId})`
5. Return mission

**`createAndDeployMission`:**
- Same as `createMission` but status = `queued` and activity event detail: `'Status: QUEUED'`

**`getMission`:**
- Query mission by ID
- Left join assets for codename/specialty
- Join battlefield for codename
- Count mission logs
- Return `MissionWithDetails`

**`listMissions`:**
- Filter by `battlefieldId`
- Optional `search` filter: `like(missions.title, '%search%')`
- Order: active statuses first (use SQL CASE for priority ordering), then `createdAt` desc
- Return `Mission[]` with asset codename joined

**`abandonMission`:**
- Validate current status is `standby` or `queued` (throw otherwise)
- Update status to `abandoned`, set `completedAt = Date.now()`
- Emit `activity:event` to `hq:activity` Socket.IO room: `{ type: 'mission:abandoned', battlefieldCodename, missionTitle, timestamp }`
- `revalidatePath`
- Return updated mission

**Note on Socket.IO in Server Actions:** Server Actions run on the server and can access `globalThis.io` (set in server.ts during Phase A) to emit events. This pattern works because the custom server owns both the Next.js handler and the Socket.IO instance.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/mission.ts
git commit -m "feat: add mission CRUD server actions"
```

---

## Task 4: Command Runner + Scaffold Route

**Files:**
- Create: `src/lib/process/command-runner.ts`
- Create: `src/app/api/battlefields/[id]/scaffold/route.ts`
- Create: `src/app/api/battlefields/[id]/scaffold/logs/route.ts`

- [ ] **Step 1: Create command runner utility**

Create `src/lib/process/command-runner.ts`:

```typescript
import { spawn } from 'child_process';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { commandLogs } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import type { RunCommandOptions, RunCommandResult } from '@/types';
// Note: globalThis.io is typed via `declare global { var io: SocketIOServer }` in server.ts (Phase A)

export async function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  const { command, cwd, socketRoom, battlefieldId, abortSignal } = options;
  const startTime = Date.now();
  let stdout = '';
  let stderr = '';
  const io = globalThis.io;

  // Create command log record if battlefieldId provided
  const logId = battlefieldId ? generateId() : null;
  if (logId && battlefieldId) {
    const db = getDatabase();
    db.insert(commandLogs).values({
      id: logId,
      battlefieldId,
      command,
      output: '',
      createdAt: startTime,
    }).run();
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      cwd,
      shell: true,
      signal: abortSignal,
    });

    const handleData = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      const text = data.toString();
      if (stream === 'stdout') stdout += text;
      else stderr += text;

      // Stream via Socket.IO
      if (socketRoom && io) {
        io.to(socketRoom).emit('console:output', {
          battlefieldId,
          content: text,
          timestamp: Date.now(),
        });
      }

      // Append to command log
      if (logId && battlefieldId) {
        const db = getDatabase();
        const current = db.select({ output: commandLogs.output })
          .from(commandLogs)
          .where(eq(commandLogs.id, logId))
          .get();
        if (current) {
          db.update(commandLogs)
            .set({ output: (current.output || '') + text })
            .where(eq(commandLogs.id, logId))
            .run();
        }
      }
    };

    proc.stdout?.on('data', handleData('stdout'));
    proc.stderr?.on('data', handleData('stderr'));

    proc.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      const exitCode = code ?? 1;

      // Update command log
      if (logId && battlefieldId) {
        const db = getDatabase();
        db.update(commandLogs)
          .set({ exitCode, durationMs })
          .where(eq(commandLogs.id, logId))
          .run();
      }

      // Emit exit event
      if (socketRoom && io) {
        io.to(socketRoom).emit('console:exit', {
          battlefieldId,
          exitCode,
          durationMs,
        });
      }

      resolve({ exitCode, stdout, stderr, durationMs });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}
```

**Note:** The command log append pattern (read + concat + update) is not optimal for high-throughput output. For B1 (scaffold commands), this is fine. If performance becomes an issue, switch to storing individual log lines as separate rows.

- [ ] **Step 2: Create scaffold route handler**

Create `src/app/api/battlefields/[id]/scaffold/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { runCommand } from '@/lib/process/command-runner';
import simpleGit from 'simple-git';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDatabase();

  const battlefield = db.select().from(battlefields).where(eq(battlefields.id, id)).get();
  if (!battlefield || !battlefield.scaffoldCommand) {
    return NextResponse.json({ error: 'No scaffold command' }, { status: 400 });
  }

  try {
    const result = await runCommand({
      command: battlefield.scaffoldCommand,
      cwd: battlefield.repoPath,
      socketRoom: `console:${id}`,
      battlefieldId: id,
    });

    if (result.exitCode === 0) {
      // Git add + commit
      const git = simpleGit(battlefield.repoPath);
      await git.add('-A');
      await git.commit('Initial scaffold');

      // Update scaffold status
      db.update(battlefields)
        .set({ scaffoldStatus: 'complete', updatedAt: Date.now() })
        .where(eq(battlefields.id, id))
        .run();
    } else {
      db.update(battlefields)
        .set({ scaffoldStatus: 'failed', updatedAt: Date.now() })
        .where(eq(battlefields.id, id))
        .run();
    }

    return NextResponse.json({ success: result.exitCode === 0, exitCode: result.exitCode });
  } catch (err) {
    db.update(battlefields)
      .set({ scaffoldStatus: 'failed', updatedAt: Date.now() })
      .where(eq(battlefields.id, id))
      .run();
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create scaffold logs endpoint**

Create `src/app/api/battlefields/[id]/scaffold/logs/route.ts`:

Returns buffered scaffold output from `commandLogs` for late Socket.IO subscribers.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields, commandLogs } from '@/lib/db/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDatabase();

  // Get the most recent command log for this battlefield's scaffold
  const battlefield = db.select().from(battlefields).where(eq(battlefields.id, id)).get();
  if (!battlefield?.scaffoldCommand) {
    return NextResponse.json({ logs: '' });
  }

  const log = db.select()
    .from(commandLogs)
    .where(and(
      eq(commandLogs.battlefieldId, id),
      eq(commandLogs.command, battlefield.scaffoldCommand)
    ))
    .orderBy(desc(commandLogs.createdAt))
    .limit(1)
    .get();

  return NextResponse.json({
    logs: log?.output || '',
    exitCode: log?.exitCode ?? null,
    isComplete: battlefield.scaffoldStatus === 'complete' || battlefield.scaffoldStatus === 'failed',
  });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/process/command-runner.ts src/app/api/battlefields/
git commit -m "feat: add command runner utility and scaffold route handler"
```

---

## Task 5: Socket.IO Updates + Hooks

**Files:**
- Modify: `src/lib/socket/server.ts`
- Create: `src/hooks/use-command-output.ts`

- [ ] **Step 1: Add unsubscribe handlers to Socket.IO server**

In `src/lib/socket/server.ts`, add alongside the existing subscribe handlers:

```typescript
socket.on('console:unsubscribe', (battlefieldId: string) => {
  socket.leave(`console:${battlefieldId}`);
});

socket.on('devserver:unsubscribe', (battlefieldId: string) => {
  socket.leave(`devserver:${battlefieldId}`);
});

socket.on('hq:unsubscribe', () => {
  socket.leave('hq:activity');
});
```

- [ ] **Step 2: Create useCommandOutput hook**

Create `src/hooks/use-command-output.ts`:

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSocket } from '@/hooks/use-socket';

interface CommandLog {
  content: string;
  timestamp: number;
}

export function useCommandOutput(battlefieldId: string) {
  const socket = useSocket();
  const [logs, setLogs] = useState<CommandLog[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(true);

  useEffect(() => {
    if (!socket) return;

    socket.emit('console:subscribe', battlefieldId);

    const handleOutput = (data: { battlefieldId: string; content: string; timestamp: number }) => {
      if (data.battlefieldId === battlefieldId) {
        setLogs(prev => [...prev, { content: data.content, timestamp: data.timestamp }]);
      }
    };

    const handleExit = (data: { battlefieldId: string; exitCode: number; durationMs: number }) => {
      if (data.battlefieldId === battlefieldId) {
        setExitCode(data.exitCode);
        setIsRunning(false);
      }
    };

    socket.on('console:output', handleOutput);
    socket.on('console:exit', handleExit);

    return () => {
      socket.off('console:output', handleOutput);
      socket.off('console:exit', handleExit);
      socket.emit('console:unsubscribe', battlefieldId);
    };
  }, [socket, battlefieldId]);

  // Prepend buffered logs (for late subscribers)
  const prependBufferedLogs = useCallback((buffered: string) => {
    if (!buffered) return;
    const lines = buffered.split('\n').filter(Boolean);
    const bufferedLogs = lines.map((content, i) => ({
      content: content + '\n',
      timestamp: 0 + i,  // synthetic timestamps for ordering
    }));
    setLogs(prev => {
      // Only prepend if we don't already have buffered logs
      if (prev.length === 0 || prev[0].timestamp > 0) {
        return [...bufferedLogs, ...prev];
      }
      return prev;
    });
  }, []);

  return { logs, exitCode, isRunning, prependBufferedLogs };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/socket/server.ts src/hooks/use-command-output.ts
git commit -m "feat: add Socket.IO unsubscribe handlers and useCommandOutput hook"
```

---

## Task 6: Battlefield Creation Form

**Files:**
- Create: `src/app/projects/new/page.tsx`
- Create: `src/components/battlefield/create-battlefield.tsx`
- Modify: `src/app/projects/page.tsx`

- [ ] **Step 1: Create the creation form component**

Create `src/components/battlefield/create-battlefield.tsx` — Client Component (`"use client"`):

**Two modes** toggled by a link/button:
- Default: "New Project" (shows scaffold command, computed repo path, default branch)
- Toggle: "Link Existing Repo" (shows repo path input, hides scaffold/branch)

**Form fields** per spec section 3. Use `TacInput`, `TacTextarea`, `TacButton`.

**Codename auto-generation:** On name change, compute codename as `OPERATION ${name.toUpperCase()}` (only if codename hasn't been manually edited).

**Computed repo path display:** Show `{DEVROOM_DEV_BASE_PATH}/{toKebabCase(name)}` below the name field. Pass `devBasePath` from server as a prop.

**Submit handler:**
1. Call `createBattlefield` Server Action
2. If scaffold command provided: fire-and-forget `fetch('/api/battlefields/${id}/scaffold', { method: 'POST' })`
3. `router.push(/projects/${id})`

**Validation:**
- Name required
- Repo path required in link mode
- Show inline error messages

- [ ] **Step 2: Create the page wrapper**

Create `src/app/projects/new/page.tsx` — Server Component:

```typescript
import { CreateBattlefield } from '@/components/battlefield/create-battlefield';
import { config } from '@/lib/config';

export default function NewBattlefieldPage() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="text-dr-muted text-xs mb-1">Battlefields //</div>
      <h1 className="text-dr-amber text-xl font-tactical tracking-wider mb-6">
        NEW BATTLEFIELD
      </h1>
      <CreateBattlefield devBasePath={config.devBasePath} />
    </div>
  );
}
```

- [ ] **Step 3: Add NEW BATTLEFIELD button to projects page**

Modify `src/app/projects/page.tsx`:
- Add a `[+ NEW BATTLEFIELD]` button/link at the top right, next to the page title
- Links to `/projects/new`
- Use `TacButton` with primary variant

- [ ] **Step 4: Test creation flow**

Start dev server, navigate to `/projects/new`:
1. Fill out form in "New Project" mode → submit → verify directory created, git initialized, redirected to battlefield page
2. Fill out form in "Link Existing Repo" mode with a real repo path → submit → verify record created, redirected
3. Test validation: empty name, non-existent repo path

- [ ] **Step 5: Commit**

```bash
git add src/app/projects/new/ src/components/battlefield/create-battlefield.tsx src/app/projects/page.tsx
git commit -m "feat: add battlefield creation form with new project and link flows"
```

---

## Task 7: Quick Deploy Form + Dossier Loading

**Files:**
- Create: `src/components/dashboard/deploy-mission.tsx`
- Modify: `src/app/projects/[id]/page.tsx`

- [ ] **Step 1: Create deploy mission component**

Create `src/components/dashboard/deploy-mission.tsx` — Client Component:

**Props:** `battlefieldId: string`, `assets: Array<{ id: string; codename: string; status: string }>`

**UI:**
- Amber header: `DEPLOY MISSION`
- Textarea for briefing (TacTextarea)
- Asset selector (TacSelect or native select styled with tactical theme)
- `[Load dossier]` link/button — triggers hidden `<input type="file" accept=".md,.txt">`
- SAVE button (success) → calls `createMission`
- SAVE & DEPLOY button (primary) → calls `createAndDeployMission`

**Dossier loading:**
```typescript
const handleDossier = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    setBriefing(reader.result as string);
    setDossierName(file.name);
  };
  reader.readAsText(file);
};
```

Show filename briefly after load: `"Loaded: requirements.md"` in dim text.

**After submit:** Clear form, show brief success indication.

- [ ] **Step 2: Wire into battlefield overview page**

Modify `src/app/projects/[id]/page.tsx`:
- Query active assets from DB
- Replace the disabled deploy form with `<DeployMission battlefieldId={id} assets={assets} />`

- [ ] **Step 3: Test deploy flow**

1. Navigate to a battlefield page
2. Type a briefing → click SAVE → verify mission created with status `standby`
3. Type a briefing → select asset → click SAVE & DEPLOY → verify mission created with status `queued`
4. Load a `.md` file → verify textarea populated
5. Verify mission list updates after creation (via revalidatePath)

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/deploy-mission.tsx src/app/projects/[id]/page.tsx
git commit -m "feat: wire quick deploy mission form with dossier loading"
```

---

## Task 8: Mission List + Stats Bar

**Files:**
- Create: `src/components/dashboard/stats-bar.tsx`
- Create: `src/components/dashboard/mission-list.tsx`
- Modify: `src/app/projects/[id]/page.tsx`

- [ ] **Step 1: Create stats bar component**

Create `src/components/dashboard/stats-bar.tsx`:

Props: `stats: { inCombat: number; accomplished: number; compromised: number; standby: number; cacheHitPercent: string }`

5 cells in a row separated by 1px gaps (`bg-dr-border` as gap color):
- Each cell: `bg-dr-surface`, large number on top (colored), uppercase label below (dim)
- IN COMBAT (amber) — includes `in_combat` + `deploying`
- ACCOMPLISHED (green)
- COMPROMISED (red)
- STANDBY (dim) — includes `standby` + `queued`
- CACHE HIT (green) — percentage or "—"

- [ ] **Step 2: Create mission list component**

Create `src/components/dashboard/mission-list.tsx` — Client Component (for search interactivity).

**Note:** The spec mentions a separate `mission-list-client.tsx` wrapper, but we merge both into a single `mission-list.tsx` Client Component. This is simpler — the component manages search state internally and renders the filtered list. No need for a separate presentational component at this scale.

Props: `missions: MissionWithAsset[]`, `battlefieldId: string`

Where `MissionWithAsset` is a mission row joined with asset codename.

**Features:**
- SearchInput at top, filters missions by title (client-side)
- Section header `MISSIONS` in amber
- Div-based rows per spec: title, asset + relative time, status badge, VIEW link
- Left border colored by status
- Empty state: "No missions deployed yet."

- [ ] **Step 3: Wire into battlefield overview page**

Modify `src/app/projects/[id]/page.tsx`:
- Compute stats from mission status counts
- Query missions with asset join for the list
- Replace placeholder stats bar with `<StatsBar stats={...} />`
- Replace empty mission section with `<MissionList missions={...} battlefieldId={id} />`

- [ ] **Step 4: Test**

1. Create several missions (mix of standby/queued)
2. Verify stats bar shows correct counts
3. Verify mission list shows all missions with correct sorting
4. Search by title — verify filtering works
5. Verify VIEW links navigate to mission detail

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ src/app/projects/[id]/page.tsx
git commit -m "feat: add mission list and stats bar with real data"
```

---

## Task 9: Mission Detail Page

**Files:**
- Modify: `src/app/projects/[id]/missions/[missionId]/page.tsx`

- [ ] **Step 1: Replace stub with full detail page**

Replace `src/app/projects/[id]/missions/[missionId]/page.tsx`:

Server Component with `await params` for both `id` and `missionId`.

**Queries:**
- `getMission(missionId)` — returns `MissionWithDetails`
- If not found: `notFound()`

**Layout sections:**
1. **Header**: Breadcrumb + title + status badge + asset + priority
2. **Briefing**: Rendered in `whitespace-pre-wrap` with `font-data`
3. **Comms**: Terminal component with placeholder message ("Awaiting deployment...")
4. **Tokens**: Card with Input/Output/CacheHit/Duration — all zeros for now
5. **Actions**: ABANDON button (danger), only enabled for standby/queued

**ABANDON handler**: Wrap in a Client Component — a small `<MissionActions>` that receives `missionId` and `status` as props and calls `abandonMission` on click. Uses `useRouter().refresh()` after action.

- [ ] **Step 2: Create mission actions client component**

Create a small inline Client Component (can be in the same directory or in `src/components/mission/`):

```typescript
'use client';
// Renders ABANDON button, calls abandonMission, refreshes page
```

- [ ] **Step 3: Test mission detail**

1. Navigate to a mission's detail page
2. Verify all sections render correctly
3. Click ABANDON on a `standby` mission → verify status changes
4. Verify ABANDON is disabled for `abandoned` missions

- [ ] **Step 4: Commit**

```bash
git add src/app/projects/[id]/missions/
git commit -m "feat: add full mission detail page with briefing and actions"
```

---

## Task 10: Scaffold Streaming UI

**Files:**
- Create: `src/components/battlefield/scaffold-output.tsx`
- Modify: `src/app/projects/[id]/page.tsx`

- [ ] **Step 1: Create scaffold output component**

Create `src/components/battlefield/scaffold-output.tsx` — Client Component:

Props: `battlefieldId: string`

**Behavior:**
1. On mount: fetch buffered logs from `GET /api/battlefields/[id]/scaffold/logs`
2. Call `prependBufferedLogs()` from `useCommandOutput` hook with the fetched content
3. Subscribe to live Socket.IO events via the hook
4. Render all output in the Terminal component
5. When `exitCode` is received: show success/failure status, trigger page refresh via `router.refresh()`
6. On unmount: Socket.IO cleanup (handled by hook)

**UI:**
- Card with header: "SCAFFOLD — Running..." or "SCAFFOLD — Complete" or "SCAFFOLD — Failed"
- Terminal component inside
- Exit code display: `✓ Exit 0` (green) or `✗ Exit {code}` (red)

- [ ] **Step 2: Wire into battlefield overview page**

Modify `src/app/projects/[id]/page.tsx`:
- Check `battlefield.scaffoldStatus`
- If `'running'`: show `<ScaffoldOutput battlefieldId={id} />` above the deploy form
- If `'failed'`: show a static error card with `[RETRY SCAFFOLD]` button (calls POST to scaffold route again)
- If `'complete'` or `null`: show normal overview

- [ ] **Step 3: Test scaffold streaming**

1. Create a new battlefield with a scaffold command (e.g., `echo "line1" && sleep 1 && echo "line2" && sleep 1 && echo "done"`)
2. Verify redirect to battlefield page shows live scaffold output
3. Verify output streams in real-time
4. Verify exit status shown on completion
5. Verify page transitions to normal overview after scaffold completes
6. Test failure case: `exit 1` scaffold command

- [ ] **Step 4: Commit**

```bash
git add src/components/battlefield/scaffold-output.tsx src/app/projects/[id]/page.tsx
git commit -m "feat: add real-time scaffold output streaming"
```

---

## Task 11: Integration Verification

**Files:**
- Various fixes

- [ ] **Step 1: Full end-to-end test**

Start the server and verify the complete flow:

1. `/projects` → shows existing battlefield + NEW BATTLEFIELD button
2. Click NEW BATTLEFIELD → creation form renders
3. Create new battlefield (new project mode with scaffold `echo "scaffolding..." && sleep 2 && echo "done"`) → redirected to battlefield page → scaffold streams in real-time → completes
4. Deploy a mission (quick deploy: type briefing, select asset, SAVE & DEPLOY) → mission appears in list as QUEUED
5. Deploy another (SAVE only) → appears as STANDBY
6. Load a dossier file → textarea populated → deploy
7. Search missions by title → filter works
8. Click VIEW on a mission → detail page shows briefing, status, asset, tokens
9. Click ABANDON on a standby mission → status changes to ABANDONED
10. Stats bar shows correct counts
11. Sidebar mission count badge updates (Phase A's sidebar already queries real mission counts per battlefield from the DB — `revalidatePath` after mutations causes the sidebar to re-render with updated counts)
12. Link an existing repo (use the DEVROOM project itself) → battlefield created

- [ ] **Step 2: Fix any issues found**

Address bugs, styling issues, TypeScript errors.

- [ ] **Step 3: Build test**

```bash
pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase B1 — battlefields and mission CRUD operational"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] New battlefield creation works (both new project and link flows)
- [ ] Scaffold commands stream output in real-time via Socket.IO
- [ ] Late subscribers see buffered scaffold output
- [ ] Scaffold status tracked (running/complete/failed)
- [ ] Quick deploy form creates missions (standby and queued)
- [ ] Dossier loading populates briefing textarea
- [ ] Mission list shows real data with status-colored borders
- [ ] Search filters missions by title
- [ ] Stats bar shows correct counts per status
- [ ] Mission detail page shows full layout (header, briefing, comms placeholder, tokens)
- [ ] ABANDON works for standby/queued missions
- [ ] Sidebar mission count reflects real data
- [ ] `pnpm build` succeeds
- [ ] No TypeScript errors
