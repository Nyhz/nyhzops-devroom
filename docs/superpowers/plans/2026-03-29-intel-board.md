# Intel Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-battlefield Kanban board ("Intel Board") for note-taking, mission tracking, and campaign creation.

**Architecture:** New `intel_notes` table with optional FK to missions/campaigns. Server actions for CRUD + promotion. Client-side board with drag-and-drop via `@hello-pangea/dnd`. Real-time card movement via existing Socket.IO `mission:status` events. Auto-creation of intel notes when missions are created from any flow.

**Tech Stack:** Drizzle ORM (SQLite), Next.js App Router (Server Components + Client Components), `@hello-pangea/dnd`, Socket.IO, `tac-textarea-with-images` for image support.

**Spec:** `docs/superpowers/specs/2026-03-29-intel-board-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/db/schema.ts` | Add `intelNotes` table definition |
| `src/types/index.ts` | Add `IntelNote`, `IntelNoteWithMission`, `BoardColumn` types |
| `src/actions/intel.ts` | Server actions: CRUD notes, reorder, promote to mission, link to campaign |
| `src/actions/mission.ts` | Hook: auto-create intel note on mission creation |
| `src/actions/campaign.ts` | Hook: auto-create intel notes on campaign mission creation |
| `src/app/(hq)/battlefields/[id]/board/page.tsx` | Board page — Server Component, fetches initial data |
| `src/app/(hq)/battlefields/[id]/board/loading.tsx` | Skeleton loader |
| `src/components/board/intel-board.tsx` | Main board — Client Component, columns, drag-drop, Socket.IO, selection |
| `src/components/board/board-column.tsx` | Single column — header, card list, droppable zone |
| `src/components/board/board-card.tsx` | Card — note variant vs linked-mission variant |
| `src/components/board/note-panel.tsx` | Right slide-out panel — create/edit note, promote actions |
| `src/hooks/use-board.ts` | Board state hook — Socket.IO subscription for mission status updates |
| `src/components/layout/sidebar-nav.tsx` | Add INTEL BOARD nav entry |
| `src/app/(hq)/battlefields/[id]/campaigns/new/form.tsx` | Read URL search params to pre-fill objective |

---

## Task 1: Database Schema + Migration

**Files:**
- Modify: `src/lib/db/schema.ts` (add `intelNotes` table after `generalMessages`, ~line 235)
- Modify: `src/types/index.ts` (add types after `BriefingMessage` type, ~line 48)
- Create: migration via `npx drizzle-kit generate`

- [ ] **Step 1: Add `intelNotes` table to Drizzle schema**

Add to `src/lib/db/schema.ts` after the `generalMessages` table:

```typescript
// ---------------------------------------------------------------------------
// Intel Notes (Board cards)
// ---------------------------------------------------------------------------
export const intelNotes = sqliteTable('intel_notes', {
  id: text('id').primaryKey(),
  battlefieldId: text('battlefield_id').notNull().references(() => battlefields.id),
  title: text('title').notNull(),
  description: text('description'),              // markdown, may contain base64 images
  column: text('column').default('backlog'),      // 'backlog' | 'planned'
  position: integer('position').default(0),
  missionId: text('mission_id').references(() => missions.id),
  campaignId: text('campaign_id').references(() => campaigns.id),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
```

- [ ] **Step 2: Add types to `src/types/index.ts`**

Add the import of `intelNotes` to the existing import block:

```typescript
import type {
  // ... existing imports ...
  generalMessages,
  intelNotes,
} from '../lib/db/schema';
```

Add after the `BriefingMessage` type:

```typescript
export type IntelNote = InferSelectModel<typeof intelNotes>;
export type IntelNoteColumn = 'backlog' | 'planned';

export interface IntelNoteWithMission extends IntelNote {
  missionStatus: MissionStatus | null;
  missionAssetCodename: string | null;
  missionCreatedAt: number | null;
}

export interface BoardColumn {
  key: string;
  label: string;
  color: string;         // tailwind color token
  acceptsDrop: boolean;  // only backlog + planned accept drops
}
```

- [ ] **Step 3: Generate migration**

Run: `npx drizzle-kit generate`

Expected: A new migration file `src/lib/db/migrations/0009_*.sql` containing the `CREATE TABLE intel_notes` statement.

- [ ] **Step 4: Verify migration applies**

Run: `npx tsx scripts/seed.ts` (or restart dev server — migrations run on boot via `runMigrations()`)

Expected: No errors. The `intel_notes` table exists in the database.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/types/index.ts src/lib/db/migrations/
git commit -m "feat(intel-board): add intel_notes schema and types"
```

---

## Task 2: Server Actions — CRUD + Reorder

**Files:**
- Create: `src/actions/intel.ts`

- [ ] **Step 1: Create `src/actions/intel.ts` with all server actions**

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { intelNotes, missions, assets } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import type { IntelNote, IntelNoteWithMission, IntelNoteColumn } from '@/types';

// ---------------------------------------------------------------------------
// listBoardNotes — fetch all notes for a battlefield, joined with mission data
// ---------------------------------------------------------------------------
export async function listBoardNotes(
  battlefieldId: string,
): Promise<IntelNoteWithMission[]> {
  const db = getDatabase();

  const rows = db
    .select({
      id: intelNotes.id,
      battlefieldId: intelNotes.battlefieldId,
      title: intelNotes.title,
      description: intelNotes.description,
      column: intelNotes.column,
      position: intelNotes.position,
      missionId: intelNotes.missionId,
      campaignId: intelNotes.campaignId,
      createdAt: intelNotes.createdAt,
      updatedAt: intelNotes.updatedAt,
      missionStatus: missions.status,
      missionAssetCodename: assets.codename,
      missionCreatedAt: missions.createdAt,
    })
    .from(intelNotes)
    .leftJoin(missions, eq(intelNotes.missionId, missions.id))
    .leftJoin(assets, eq(missions.assetId, assets.id))
    .where(eq(intelNotes.battlefieldId, battlefieldId))
    .orderBy(intelNotes.position, desc(intelNotes.createdAt))
    .all();

  return rows as IntelNoteWithMission[];
}

// ---------------------------------------------------------------------------
// createNote
// ---------------------------------------------------------------------------
export async function createNote(
  battlefieldId: string,
  title: string,
  description: string | null,
): Promise<IntelNote> {
  const db = getDatabase();
  const id = generateId();
  const now = Date.now();

  // Shift existing backlog positions down to make room at top
  db.update(intelNotes)
    .set({ position: sql`${intelNotes.position} + 1` })
    .where(
      and(
        eq(intelNotes.battlefieldId, battlefieldId),
        eq(intelNotes.column, 'backlog'),
        isNull(intelNotes.missionId),
      ),
    )
    .run();

  const record = db
    .insert(intelNotes)
    .values({
      id,
      battlefieldId,
      title,
      description,
      column: 'backlog',
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  revalidatePath(`/battlefields/${battlefieldId}/board`);
  return record;
}

// ---------------------------------------------------------------------------
// updateNote
// ---------------------------------------------------------------------------
export async function updateNote(
  noteId: string,
  data: { title?: string; description?: string | null },
): Promise<IntelNote> {
  const db = getDatabase();
  const note = getOrThrow(intelNotes, noteId, 'updateNote');

  if (note.missionId) {
    throw new Error('updateNote: cannot edit a linked note');
  }

  const updated = db
    .update(intelNotes)
    .set({
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      updatedAt: Date.now(),
    })
    .where(eq(intelNotes.id, noteId))
    .returning()
    .get();

  revalidatePath(`/battlefields/${note.battlefieldId}/board`);
  return updated;
}

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------
export async function deleteNote(noteId: string): Promise<void> {
  const db = getDatabase();
  const note = getOrThrow(intelNotes, noteId, 'deleteNote');

  if (note.missionId) {
    throw new Error('deleteNote: cannot delete a linked note — abandon the mission instead');
  }

  db.delete(intelNotes).where(eq(intelNotes.id, noteId)).run();
  revalidatePath(`/battlefields/${note.battlefieldId}/board`);
}

// ---------------------------------------------------------------------------
// moveNote — drag between columns or reorder within column
// ---------------------------------------------------------------------------
export async function moveNote(
  noteId: string,
  targetColumn: IntelNoteColumn,
  targetPosition: number,
): Promise<void> {
  const db = getDatabase();
  const note = getOrThrow(intelNotes, noteId, 'moveNote');

  if (note.missionId) {
    throw new Error('moveNote: cannot move a linked note');
  }

  db.update(intelNotes)
    .set({
      column: targetColumn,
      position: targetPosition,
      updatedAt: Date.now(),
    })
    .where(eq(intelNotes.id, noteId))
    .run();

  revalidatePath(`/battlefields/${note.battlefieldId}/board`);
}

// ---------------------------------------------------------------------------
// linkNoteToMission — set missionId on a note after promotion
// ---------------------------------------------------------------------------
export async function linkNoteToMission(
  noteId: string,
  missionId: string,
): Promise<void> {
  const db = getDatabase();
  const note = getOrThrow(intelNotes, noteId, 'linkNoteToMission');

  db.update(intelNotes)
    .set({
      missionId,
      updatedAt: Date.now(),
    })
    .where(eq(intelNotes.id, noteId))
    .run();

  revalidatePath(`/battlefields/${note.battlefieldId}/board`);
}

// ---------------------------------------------------------------------------
// linkNotesToCampaign — set campaignId on multiple notes
// ---------------------------------------------------------------------------
export async function linkNotesToCampaign(
  noteIds: string[],
  campaignId: string,
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  for (const noteId of noteIds) {
    db.update(intelNotes)
      .set({ campaignId, updatedAt: now })
      .where(eq(intelNotes.id, noteId))
      .run();
  }

  // Revalidate — get battlefieldId from first note
  const first = db.select().from(intelNotes).where(eq(intelNotes.id, noteIds[0])).get();
  if (first) {
    revalidatePath(`/battlefields/${first.battlefieldId}/board`);
  }
}

// ---------------------------------------------------------------------------
// getNote — single note fetch for panel
// ---------------------------------------------------------------------------
export async function getNote(noteId: string): Promise<IntelNote> {
  return getOrThrow(intelNotes, noteId, 'getNote');
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`

Expected: No type errors in `src/actions/intel.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/actions/intel.ts
git commit -m "feat(intel-board): add server actions for intel notes CRUD"
```

---

## Task 3: Auto-Create Intel Notes on Mission Creation

**Files:**
- Modify: `src/actions/mission.ts` (~line 28, inside `_createMission`)
- Modify: `src/actions/campaign.ts` (~line 142, inside `insertPlanFromJSON`)

- [ ] **Step 1: Add auto-create hook in `_createMission`**

In `src/actions/mission.ts`, add an import for `intelNotes` at the top:

```typescript
import { missions, assets, battlefields, missionLogs, captainLogs, intelNotes } from '@/lib/db/schema';
```

Then, inside `_createMission`, after the `db.insert(missions)...` block and before the Socket.IO emit (~line 56), add:

```typescript
  // Auto-create intel note for board visibility
  db.insert(intelNotes)
    .values({
      id: generateId(),
      battlefieldId: data.battlefieldId,
      title,
      description: null,
      missionId: id,
      campaignId: null,
      column: 'backlog',
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
```

- [ ] **Step 2: Add auto-create hook in `insertPlanFromJSON`**

In `src/actions/campaign.ts`, add `intelNotes` to the existing schema import:

```typescript
import { campaigns, phases, missions, missionLogs, assets, intelNotes } from '@/lib/db/schema';
```

Inside `insertPlanFromJSON`, after the `db.insert(missions).values(...)` call for each mission (~line 162), add:

```typescript
      // Auto-create intel note for board visibility
      db.insert(intelNotes)
        .values({
          id: generateId(),
          battlefieldId,
          title: planMission.title,
          description: null,
          missionId,
          campaignId,
          column: 'backlog',
          position: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
```

Also add the `generateId` import if not already present (check — it is already imported).

- [ ] **Step 3: Add auto-create hook in `cloneCampaignPlan`**

In `src/actions/campaign.ts`, inside `cloneCampaignPlan`, after the `db.insert(missions).values(...)` call (~line 107), add:

```typescript
      db.insert(intelNotes)
        .values({
          id: generateId(),
          battlefieldId: targetBattlefieldId,
          title: originalMission.title,
          description: null,
          missionId: newMissionId,
          campaignId: targetCampaignId,
          column: 'backlog',
          position: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
```

- [ ] **Step 4: Add auto-create hook in `continueMission`**

In `src/actions/mission.ts`, inside `continueMission`, after `db.insert(missions).values(newMission).run()` (~line 373), add:

```typescript
  // Auto-create intel note for board visibility
  db.insert(intelNotes)
    .values({
      id: generateId(),
      battlefieldId: original.battlefieldId,
      title,
      description: null,
      missionId: id,
      campaignId: null,
      column: 'backlog',
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
```

- [ ] **Step 5: Add cleanup in `removeMission`**

In `src/actions/mission.ts`, inside `removeMission`, before `db.delete(missions)` (~line 416), add:

```typescript
  // Clean up intel note
  db.delete(intelNotes).where(eq(intelNotes.missionId, id)).run();
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add src/actions/mission.ts src/actions/campaign.ts
git commit -m "feat(intel-board): auto-create intel notes on mission creation"
```

---

## Task 4: Sidebar Navigation

**Files:**
- Modify: `src/components/layout/sidebar-nav.tsx` (~line 14, in `NAV_ITEMS` array)

- [ ] **Step 1: Add INTEL BOARD nav entry**

In `src/components/layout/sidebar-nav.tsx`, add the new entry between CAMPAIGNS and GIT in the `NAV_ITEMS` array:

```typescript
const NAV_ITEMS: NavItem[] = [
  { icon: "■", label: "MISSIONS", segment: "", countKey: "missions" },
  { icon: "✕", label: "CAMPAIGNS", segment: "campaigns", countKey: "campaigns" },
  { icon: "⊞", label: "INTEL BOARD", segment: "board" },
  { icon: "◆", label: "GIT", segment: "git" },
  { icon: "▶", label: "CONSOLE", segment: "console" },
  { icon: "⏱", label: "SCHEDULE", segment: "schedule" },
  { icon: "⚙", label: "CONFIG", segment: "config" },
];
```

- [ ] **Step 2: Verify the nav renders**

Run: dev server should show the new INTEL BOARD entry in the sidebar when viewing a battlefield.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/sidebar-nav.tsx
git commit -m "feat(intel-board): add INTEL BOARD to sidebar navigation"
```

---

## Task 5: Board Page + Loading Skeleton

**Files:**
- Create: `src/app/(hq)/battlefields/[id]/board/page.tsx`
- Create: `src/app/(hq)/battlefields/[id]/board/loading.tsx`

- [ ] **Step 1: Create loading skeleton**

Create `src/app/(hq)/battlefields/[id]/board/loading.tsx`:

```typescript
export default function BoardLoading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-5 w-40 bg-dr-elevated animate-pulse" />
        <div className="flex gap-2">
          <div className="h-8 w-28 bg-dr-elevated animate-pulse" />
          <div className="h-8 w-36 bg-dr-elevated animate-pulse" />
        </div>
      </div>
      {/* Columns */}
      <div className="flex gap-3 overflow-x-auto">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-56 flex flex-col gap-2">
            <div className="h-4 w-24 bg-dr-elevated animate-pulse" />
            {Array.from({ length: 3 - Math.min(i, 2) }).map((_, j) => (
              <div key={j} className="h-16 bg-dr-elevated animate-pulse" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create board page (Server Component)**

Create `src/app/(hq)/battlefields/[id]/board/page.tsx`:

```typescript
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { listBoardNotes } from '@/actions/intel';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { IntelBoard } from '@/components/board/intel-board';
import type { Battlefield } from '@/types';

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get() as Battlefield | undefined;

  if (!battlefield || battlefield.status !== 'active') {
    notFound();
  }

  const notes = await listBoardNotes(id);

  return (
    <PageWrapper breadcrumb={battlefield.codename} title="INTEL BOARD">
      <IntelBoard battlefieldId={id} initialNotes={notes} />
    </PageWrapper>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(hq\)/battlefields/\[id\]/board/
git commit -m "feat(intel-board): add board page and loading skeleton"
```

---

## Task 6: Board State Hook

**Files:**
- Create: `src/hooks/use-board.ts`

- [ ] **Step 1: Create `src/hooks/use-board.ts`**

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';
import type { IntelNoteWithMission, MissionStatus } from '@/types';

// Column definitions matching the spec
export const BOARD_COLUMNS = [
  { key: 'backlog', label: 'BACKLOG', color: 'dr-muted', acceptsDrop: true },
  { key: 'planned', label: 'PLANNED', color: 'dr-muted', acceptsDrop: true },
  { key: 'deploying', label: 'DEPLOYING', color: 'dr-amber', acceptsDrop: false },
  { key: 'in_combat', label: 'IN COMBAT', color: 'dr-amber', acceptsDrop: false },
  { key: 'reviewing', label: 'REVIEWING', color: 'dr-blue', acceptsDrop: false },
  { key: 'accomplished', label: 'ACCOMPLISHED', color: 'dr-green', acceptsDrop: false },
  { key: 'compromised', label: 'COMPROMISED', color: 'dr-red', acceptsDrop: false },
] as const;

// Map mission status → board column key
function getColumnForNote(note: IntelNoteWithMission): string {
  // Linked card — column derived from mission status
  if (note.missionId && note.missionStatus) {
    const status = note.missionStatus;
    if (status === 'standby' || status === 'queued') return 'planned';
    if (status === 'abandoned') return 'abandoned'; // hidden
    return status; // deploying, in_combat, reviewing, accomplished, compromised
  }
  // Campaign-linked but no mission yet — show in planned
  if (note.campaignId && !note.missionId) return 'planned';
  // Unpromoted note — use manual column
  return note.column ?? 'backlog';
}

export interface UseBoardReturn {
  columns: Map<string, IntelNoteWithMission[]>;
  updateNoteLocally: (noteId: string, updates: Partial<IntelNoteWithMission>) => void;
  addNoteLocally: (note: IntelNoteWithMission) => void;
  removeNoteLocally: (noteId: string) => void;
}

export function useBoard(
  battlefieldId: string,
  initialNotes: IntelNoteWithMission[],
): UseBoardReturn {
  const [notes, setNotes] = useState<IntelNoteWithMission[]>(initialNotes);
  const socket = useSocket();
  const reconnectKey = useReconnectKey();

  // Listen for mission status changes and update cards
  useEffect(() => {
    if (!socket) return;

    // Subscribe to battlefield-level mission events
    socket.emit('battlefield:subscribe', battlefieldId);

    const handleMissionStatus = (data: { missionId: string; status: string }) => {
      setNotes(prev =>
        prev.map(note =>
          note.missionId === data.missionId
            ? { ...note, missionStatus: data.status as MissionStatus }
            : note,
        ),
      );
    };

    socket.on('mission:status', handleMissionStatus);

    return () => {
      socket.off('mission:status', handleMissionStatus);
    };
  }, [socket, battlefieldId, reconnectKey]);

  // Build column map
  const columns = new Map<string, IntelNoteWithMission[]>();
  for (const col of BOARD_COLUMNS) {
    columns.set(col.key, []);
  }

  for (const note of notes) {
    const colKey = getColumnForNote(note);
    if (colKey === 'abandoned') continue; // hidden
    const col = columns.get(colKey);
    if (col) col.push(note);
  }

  // Sort each column: unpromoted by position, linked by createdAt desc
  for (const [, cards] of columns) {
    cards.sort((a, b) => {
      if (!a.missionId && !b.missionId) return (a.position ?? 0) - (b.position ?? 0);
      if (!a.missionId) return -1; // notes before missions within same column
      if (!b.missionId) return 1;
      return (b.missionCreatedAt ?? 0) - (a.missionCreatedAt ?? 0);
    });
  }

  const updateNoteLocally = useCallback((noteId: string, updates: Partial<IntelNoteWithMission>) => {
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, ...updates } : n));
  }, []);

  const addNoteLocally = useCallback((note: IntelNoteWithMission) => {
    setNotes(prev => [note, ...prev]);
  }, []);

  const removeNoteLocally = useCallback((noteId: string) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
  }, []);

  return { columns, updateNoteLocally, addNoteLocally, removeNoteLocally };
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-board.ts
git commit -m "feat(intel-board): add useBoard hook with Socket.IO status tracking"
```

---

## Task 7: Board Card Component

**Files:**
- Create: `src/components/board/board-card.tsx`

- [ ] **Step 1: Create `src/components/board/board-card.tsx`**

```typescript
'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import type { IntelNoteWithMission, MissionStatus } from '@/types';

const STATUS_COLORS: Record<string, string> = {
  standby: 'border-l-dr-muted/40',
  queued: 'border-l-dr-muted/40',
  deploying: 'border-l-dr-amber/50',
  in_combat: 'border-l-dr-amber',
  reviewing: 'border-l-dr-blue/50',
  accomplished: 'border-l-dr-green/40',
  compromised: 'border-l-dr-red/40',
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  standby: 'text-dr-muted/60',
  queued: 'text-dr-muted/60',
  deploying: 'text-dr-amber/60',
  in_combat: 'text-dr-amber/70',
  reviewing: 'text-dr-blue/60',
  accomplished: 'text-dr-green/50',
  compromised: 'text-dr-red/50',
};

interface BoardCardProps {
  note: IntelNoteWithMission;
  isSelected: boolean;
  onSelect: (noteId: string) => void;
  onClick: (note: IntelNoteWithMission) => void;
}

export function BoardCard({ note, isSelected, onSelect, onClick }: BoardCardProps) {
  const isLinked = !!note.missionId;
  const status = note.missionStatus as MissionStatus | null;
  const statusLabel = status?.toUpperCase().replace('_', ' ') ?? null;

  const borderClass = isLinked && status
    ? STATUS_COLORS[status] ?? 'border-l-dr-muted/20'
    : 'border-l-white/15';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick(note);
  };

  const handleCheckbox = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(note.id);
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        'group relative bg-dr-surface/50 border border-dr-border/50 border-l-2 px-3 py-2 cursor-pointer transition-colors',
        borderClass,
        isSelected && 'border-dr-amber/40 bg-dr-amber/5',
        isLinked && status === 'accomplished' && 'opacity-70',
      )}
    >
      {/* Selection checkbox — only for unpromoted notes */}
      {!isLinked && (
        <div
          onClick={handleCheckbox}
          className={cn(
            'absolute top-1.5 right-1.5 w-3.5 h-3.5 border transition-colors cursor-pointer',
            isSelected
              ? 'border-dr-amber bg-dr-amber/20'
              : 'border-dr-border/50 opacity-0 group-hover:opacity-100',
          )}
        />
      )}

      {/* Pulsing dot for IN COMBAT */}
      {isLinked && status === 'in_combat' && (
        <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-dr-amber animate-pulse" />
      )}

      {/* Title */}
      <div className={cn(
        'text-[11px] leading-tight mb-1 pr-4',
        isLinked ? 'text-dr-text/80' : 'text-dr-text/70',
      )}>
        {note.title}
      </div>

      {/* Metadata line */}
      <div className="flex items-center justify-between">
        {isLinked && status ? (
          <span className={cn('text-[9px] font-tactical', STATUS_TEXT_COLORS[status] ?? 'text-dr-muted/40')}>
            ↗ {statusLabel}{note.missionAssetCodename ? ` · ${note.missionAssetCodename}` : ''}
          </span>
        ) : note.campaignId ? (
          <span className="text-[9px] font-tactical text-dr-blue/50">
            ⚑ Campaign
          </span>
        ) : (
          <span className="text-[9px] text-dr-dim">
            Note
          </span>
        )}
        <span className="text-[9px] text-dr-dim/50">
          {formatRelativeTime(note.missionCreatedAt ?? note.createdAt)}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/board/board-card.tsx
git commit -m "feat(intel-board): add BoardCard component with note and linked variants"
```

---

## Task 8: Board Column Component

**Files:**
- Create: `src/components/board/board-column.tsx`

- [ ] **Step 1: Install `@hello-pangea/dnd`**

Run: `pnpm add @hello-pangea/dnd`

Expected: Package added to `package.json`.

- [ ] **Step 2: Create `src/components/board/board-column.tsx`**

```typescript
'use client';

import { Droppable, Draggable } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import { BoardCard } from './board-card';
import type { IntelNoteWithMission } from '@/types';

interface BoardColumnProps {
  columnKey: string;
  label: string;
  color: string;
  acceptsDrop: boolean;
  cards: IntelNoteWithMission[];
  selectedIds: Set<string>;
  onSelect: (noteId: string) => void;
  onCardClick: (note: IntelNoteWithMission) => void;
}

export function BoardColumn({
  columnKey,
  label,
  color,
  acceptsDrop,
  cards,
  selectedIds,
  onSelect,
  onCardClick,
}: BoardColumnProps) {
  return (
    <div className="flex-shrink-0 w-52 flex flex-col min-h-0">
      {/* Column header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className={cn('text-[11px] font-tactical tracking-widest', `text-${color}/50`)}>
          {label}
        </span>
        <span className="text-[10px] text-dr-dim/30">{cards.length || ''}</span>
      </div>

      {/* Droppable zone */}
      <Droppable droppableId={columnKey} isDropDisabled={!acceptsDrop}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              'flex-1 flex flex-col gap-1.5 p-1.5 rounded-sm min-h-[60px] overflow-y-auto',
              'bg-white/[0.02] border border-transparent',
              snapshot.isDraggingOver && acceptsDrop && 'border-dr-amber/20 bg-dr-amber/[0.03]',
            )}
          >
            {cards.map((card, index) => {
              const isDraggable = !card.missionId; // Only unpromoted notes are draggable
              if (isDraggable) {
                return (
                  <Draggable key={card.id} draggableId={card.id} index={index}>
                    {(dragProvided) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...dragProvided.dragHandleProps}
                      >
                        <BoardCard
                          note={card}
                          isSelected={selectedIds.has(card.id)}
                          onSelect={onSelect}
                          onClick={onCardClick}
                        />
                      </div>
                    )}
                  </Draggable>
                );
              }

              // Linked cards — not draggable, just rendered
              return (
                <div key={card.id}>
                  <BoardCard
                    note={card}
                    isSelected={false}
                    onSelect={onSelect}
                    onClick={onCardClick}
                  />
                </div>
              );
            })}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/board/board-column.tsx package.json pnpm-lock.yaml
git commit -m "feat(intel-board): add BoardColumn with drag-and-drop via @hello-pangea/dnd"
```

---

## Task 9: Note Side Panel

**Files:**
- Create: `src/components/board/note-panel.tsx`

- [ ] **Step 1: Create `src/components/board/note-panel.tsx`**

```typescript
'use client';

import { useState, useEffect, useTransition, useCallback } from 'react';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import { TacTextareaWithImages } from '@/components/ui/tac-textarea-with-images';
import { createNote, updateNote, deleteNote } from '@/actions/intel';
import { formatRelativeTime, cn } from '@/lib/utils';
import type { IntelNoteWithMission } from '@/types';

interface NotePanelProps {
  battlefieldId: string;
  note: IntelNoteWithMission | null; // null = create mode
  onClose: () => void;
  onCreated: (note: IntelNoteWithMission) => void;
  onUpdated: (noteId: string, updates: Partial<IntelNoteWithMission>) => void;
  onDeleted: (noteId: string) => void;
  onPromoteMission: (note: IntelNoteWithMission) => void;
  onPromoteCampaign: (notes: IntelNoteWithMission[]) => void;
}

export function NotePanel({
  battlefieldId,
  note,
  onClose,
  onCreated,
  onUpdated,
  onDeleted,
  onPromoteMission,
  onPromoteCampaign,
}: NotePanelProps) {
  const isCreate = !note;
  const isLinked = !!note?.missionId;
  const [title, setTitle] = useState(note?.title ?? '');
  const [description, setDescription] = useState(note?.description ?? '');
  const [isPending, startTransition] = useTransition();

  // Reset form when note changes
  useEffect(() => {
    setTitle(note?.title ?? '');
    setDescription(note?.description ?? '');
  }, [note]);

  const handleSave = () => {
    if (!title.trim()) return;
    startTransition(async () => {
      if (isCreate) {
        const created = await createNote(
          battlefieldId,
          title.trim(),
          description.trim() || null,
        );
        onCreated({
          ...created,
          missionStatus: null,
          missionAssetCodename: null,
          missionCreatedAt: null,
        });
        onClose();
      } else if (note) {
        await updateNote(note.id, {
          title: title.trim(),
          description: description.trim() || null,
        });
        onUpdated(note.id, { title: title.trim(), description: description.trim() || null });
        onClose();
      }
    });
  };

  const handleDelete = () => {
    if (!note) return;
    startTransition(async () => {
      await deleteNote(note.id);
      onDeleted(note.id);
      onClose();
    });
  };

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[400px] bg-dr-bg border-l border-dr-border z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dr-border/50">
          <span className="font-tactical text-xs text-dr-amber tracking-widest uppercase">
            {isCreate ? 'NEW NOTE' : isLinked ? 'LINKED MISSION' : 'EDIT NOTE'}
          </span>
          <button onClick={onClose} className="text-dr-dim hover:text-dr-text text-sm">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {isLinked ? (
            // Read-only for linked cards
            <>
              <div>
                <div className="font-tactical text-xs text-dr-dim uppercase tracking-wider mb-1">TITLE</div>
                <div className="text-dr-text text-sm">{note?.title}</div>
              </div>
              {note?.description && (
                <div>
                  <div className="font-tactical text-xs text-dr-dim uppercase tracking-wider mb-1">DESCRIPTION</div>
                  <div className="text-dr-muted text-sm whitespace-pre-wrap">{note.description}</div>
                </div>
              )}
            </>
          ) : (
            // Editable for notes
            <>
              <div>
                <label className="block font-tactical text-xs text-dr-dim uppercase tracking-wider mb-2">
                  TITLE
                </label>
                <TacInput
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Note title..."
                  disabled={isPending}
                />
              </div>
              <div className="flex-1 flex flex-col">
                <label className="block font-tactical text-xs text-dr-dim uppercase tracking-wider mb-2">
                  DESCRIPTION
                </label>
                <TacTextareaWithImages
                  value={description}
                  onChange={setDescription}
                  placeholder="Detailed description, paste or drop images..."
                  disabled={isPending}
                  className="flex-1 min-h-[200px]"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-dr-border/50 px-4 py-3 flex flex-col gap-2">
          {note && (
            <div className="text-dr-dim text-[10px] font-tactical mb-1">
              Created {formatRelativeTime(note.createdAt)}
            </div>
          )}

          {!isLinked && (
            <div className="flex items-center gap-2">
              <TacButton
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={isPending || !title.trim()}
              >
                {isCreate ? 'CREATE' : 'SAVE'}
              </TacButton>

              {!isCreate && note && (
                <>
                  <TacButton
                    variant="success"
                    size="sm"
                    onClick={() => onPromoteMission(note)}
                    disabled={isPending}
                  >
                    DEPLOY MISSION
                  </TacButton>
                  <TacButton
                    variant="ghost"
                    size="sm"
                    onClick={() => onPromoteCampaign([note])}
                    disabled={isPending}
                  >
                    LAUNCH CAMPAIGN
                  </TacButton>
                  <div className="flex-1" />
                  <TacButton
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isPending}
                    className="text-dr-red/60 hover:text-dr-red"
                  >
                    DELETE
                  </TacButton>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/board/note-panel.tsx
git commit -m "feat(intel-board): add NotePanel slide-out for create/edit/promote"
```

---

## Task 10: Main Intel Board Component

**Files:**
- Create: `src/components/board/intel-board.tsx`

- [ ] **Step 1: Create `src/components/board/intel-board.tsx`**

```typescript
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { BoardColumn } from './board-column';
import { NotePanel } from './note-panel';
import { useBoard, BOARD_COLUMNS } from '@/hooks/use-board';
import { moveNote } from '@/actions/intel';
import { cn } from '@/lib/utils';
import type { IntelNoteWithMission, IntelNoteColumn } from '@/types';

interface IntelBoardProps {
  battlefieldId: string;
  initialNotes: IntelNoteWithMission[];
}

export function IntelBoard({ battlefieldId, initialNotes }: IntelBoardProps) {
  const router = useRouter();
  const { columns, updateNoteLocally, addNoteLocally, removeNoteLocally } = useBoard(battlefieldId, initialNotes);

  // Selection state — only unpromoted notes
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Panel state
  const [panelNote, setPanelNote] = useState<IntelNoteWithMission | null | 'create'>(null);

  const selectedCount = selectedIds.size;

  // Toggle selection
  const handleSelect = useCallback((noteId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  }, []);

  // Card click — open panel for notes, navigate for linked cards
  const handleCardClick = useCallback((note: IntelNoteWithMission) => {
    if (note.missionId) {
      router.push(`/battlefields/${battlefieldId}/missions/${note.missionId}`);
    } else {
      setPanelNote(note);
    }
  }, [router, battlefieldId]);

  // Drag and drop
  const handleDragEnd = useCallback((result: DropResult) => {
    const { draggableId, destination } = result;
    if (!destination) return;

    const targetColumn = destination.droppableId as IntelNoteColumn;
    const targetPosition = destination.index;

    // Optimistic update
    updateNoteLocally(draggableId, {
      column: targetColumn,
      position: targetPosition,
    });

    // Persist
    moveNote(draggableId, targetColumn, targetPosition).catch((err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to move note');
    });
  }, [updateNoteLocally]);

  // Promote single note → mission
  const handlePromoteMission = useCallback((note: IntelNoteWithMission) => {
    const briefing = note.description
      ? `# ${note.title}\n\n${note.description}`
      : note.title;
    const params = new URLSearchParams({
      briefing,
      noteId: note.id,
    });
    router.push(`/battlefields/${battlefieldId}?${params.toString()}`);
  }, [router, battlefieldId]);

  // Promote notes → campaign
  const handlePromoteCampaign = useCallback((notes: IntelNoteWithMission[]) => {
    const notesToPromote = notes.length > 0
      ? notes
      : Array.from(selectedIds)
          .map(id => {
            for (const [, cards] of columns) {
              const found = cards.find(c => c.id === id);
              if (found) return found;
            }
            return null;
          })
          .filter(Boolean) as IntelNoteWithMission[];

    if (notesToPromote.length === 0) return;

    // Build briefing from note titles + descriptions
    const briefingParts = notesToPromote.map(n => {
      const desc = n.description ? `\n${n.description}` : '';
      return `## ${n.title}${desc}`;
    });
    const objective = briefingParts.join('\n\n');
    const noteIds = notesToPromote.map(n => n.id).join(',');

    const params = new URLSearchParams({ objective, noteIds });
    router.push(`/battlefields/${battlefieldId}/campaigns/new?${params.toString()}`);
  }, [router, battlefieldId, selectedIds, columns]);

  // Count active missions
  const activeCount = Array.from(columns.values())
    .flat()
    .filter(n => n.missionId && ['deploying', 'in_combat', 'reviewing'].includes(n.missionStatus ?? ''))
    .length;

  const totalCount = Array.from(columns.values()).flat().length;

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="font-tactical text-xs text-dr-amber tracking-widest">⊞ INTEL BOARD</span>
          <span className="text-dr-dim text-[11px]">
            {totalCount} cards{activeCount > 0 && ` · ${activeCount} active`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <TacButton
            variant="primary"
            size="sm"
            onClick={() => setPanelNote('create')}
          >
            + NEW NOTE
          </TacButton>

          <TacButton
            variant="success"
            size="sm"
            disabled={selectedCount !== 1}
            onClick={() => {
              const noteId = Array.from(selectedIds)[0];
              for (const [, cards] of columns) {
                const found = cards.find(c => c.id === noteId);
                if (found) { handlePromoteMission(found); break; }
              }
            }}
          >
            DEPLOY MISSION
          </TacButton>

          <TacButton
            variant="ghost"
            size="sm"
            disabled={selectedCount === 0}
            onClick={() => handlePromoteCampaign([])}
            className={cn(selectedCount > 0 && 'border-dr-amber/30 text-dr-amber')}
          >
            ⚡ LAUNCH CAMPAIGN{selectedCount > 0 && ` (${selectedCount})`}
          </TacButton>
        </div>
      </div>

      {/* Columns */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto flex-1 pb-2">
          {BOARD_COLUMNS.map((col) => (
            <BoardColumn
              key={col.key}
              columnKey={col.key}
              label={col.label}
              color={col.color}
              acceptsDrop={col.acceptsDrop}
              cards={columns.get(col.key) ?? []}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onCardClick={handleCardClick}
            />
          ))}
        </div>
      </DragDropContext>

      {/* Side panel */}
      {panelNote !== null && (
        <NotePanel
          battlefieldId={battlefieldId}
          note={panelNote === 'create' ? null : panelNote}
          onClose={() => setPanelNote(null)}
          onCreated={addNoteLocally}
          onUpdated={updateNoteLocally}
          onDeleted={removeNoteLocally}
          onPromoteMission={handlePromoteMission}
          onPromoteCampaign={handlePromoteCampaign}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/board/intel-board.tsx
git commit -m "feat(intel-board): add IntelBoard main component with DnD and selection"
```

---

## Task 11: Pre-Fill Integration — Missions Page

**Files:**
- Modify: `src/components/dashboard/deploy-mission.tsx` (~line 11, add noteId prop)
- Modify: `src/app/(hq)/battlefields/[id]/page.tsx` (~line 126, pass search params)

- [ ] **Step 1: Update DeployMission to accept pre-fill props**

In `src/components/dashboard/deploy-mission.tsx`, update the interface and component:

Add to the interface:

```typescript
interface DeployMissionProps {
  battlefieldId: string;
  assets: Array<{ id: string; codename: string; status: string }>;
  className?: string;
  initialBriefing?: string;
  noteId?: string;
}
```

Update the component signature:

```typescript
export function DeployMission({ battlefieldId, assets, className, initialBriefing, noteId }: DeployMissionProps) {
  const [briefing, setBriefing] = useState(initialBriefing ?? '');
```

Add an import for `linkNoteToMission`:

```typescript
import { linkNoteToMission } from '@/actions/intel';
```

Inside `handleSave` and `handleSaveAndDeploy`, after the mission is created, add the note linking logic. Update both handlers — here is `handleSave` as example (apply the same pattern to `handleSaveAndDeploy`):

```typescript
  const handleSave = () => {
    if (!briefing.trim()) return;
    startTransition(async () => {
      try {
        const mission = await createMission({
          battlefieldId,
          briefing: briefing.trim(),
          assetId: assetId || undefined,
        });
        if (noteId) {
          await linkNoteToMission(noteId, mission.id);
        }
        resetForm();
        toast.success('Mission saved — STANDBY');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create mission');
      }
    });
  };
```

Apply the identical `if (noteId)` block to `handleSaveAndDeploy`.

- [ ] **Step 2: Update battlefield page to pass search params**

In `src/app/(hq)/battlefields/[id]/page.tsx`, update the page component to accept `searchParams`:

```typescript
export default async function BattlefieldOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { id } = await params;
  const { briefing: prefillBriefing, noteId } = await searchParams;
```

Then pass these to `DeployMission`:

```typescript
      <DeployMission
        battlefieldId={id}
        assets={assetList}
        initialBriefing={prefillBriefing}
        noteId={noteId}
      />
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/deploy-mission.tsx src/app/\(hq\)/battlefields/\[id\]/page.tsx
git commit -m "feat(intel-board): pre-fill deploy form from intel note promotion"
```

---

## Task 12: Pre-Fill Integration — Campaign Creation

**Files:**
- Modify: `src/app/(hq)/battlefields/[id]/campaigns/new/page.tsx`
- Modify: `src/app/(hq)/battlefields/[id]/campaigns/new/form.tsx`

- [ ] **Step 1: Update NewCampaignPage to read search params**

In `src/app/(hq)/battlefields/[id]/campaigns/new/page.tsx`, update to pass search params to the form:

```typescript
export default async function NewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { id } = await params;
  const { objective: prefillObjective, noteIds } = await searchParams;
  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, id)).get();

  return (
    <PageWrapper
      maxWidth
      breadcrumb={[bf?.codename ?? '', 'CAMPAIGNS']}
      title="NEW CAMPAIGN"
    >
      <NewCampaignForm
        battlefieldId={id}
        initialObjective={prefillObjective}
        noteIds={noteIds}
      />
    </PageWrapper>
  );
}
```

- [ ] **Step 2: Update NewCampaignForm to use pre-fill props**

In `src/app/(hq)/battlefields/[id]/campaigns/new/form.tsx`:

Add import:

```typescript
import { linkNotesToCampaign } from '@/actions/intel';
```

Update the interface and initial state:

```typescript
interface NewCampaignFormProps {
  battlefieldId: string;
  initialObjective?: string;
  noteIds?: string;
}

export function NewCampaignForm({ battlefieldId, initialObjective, noteIds }: NewCampaignFormProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState(initialObjective ?? '');
```

In the `handleSubmit` function, after campaign creation, link the notes:

```typescript
    try {
      const campaign = await createCampaign(battlefieldId, name.trim(), objective.trim());
      if (noteIds) {
        const ids = noteIds.split(',').filter(Boolean);
        if (ids.length > 0) {
          await linkNotesToCampaign(ids, campaign.id);
        }
      }
      router.push(`/battlefields/${battlefieldId}/campaigns/${campaign.id}`);
    } catch (err) {
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(hq\)/battlefields/\[id\]/campaigns/new/
git commit -m "feat(intel-board): pre-fill campaign form from intel note selection"
```

---

## Task 13: End-to-End Verification

**Files:** None (manual testing)

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`

Expected: Server starts without errors.

- [ ] **Step 2: Navigate to a battlefield → INTEL BOARD**

Expected: Board page renders with columns. Any existing missions appear as linked cards (auto-created intel notes from Task 3).

- [ ] **Step 3: Create a note**

Click "+ NEW NOTE", enter a title and description, click CREATE.

Expected: Note appears in BACKLOG column. Side panel closes.

- [ ] **Step 4: Drag note from BACKLOG to PLANNED**

Expected: Card moves to PLANNED column. Page reload shows it persisted.

- [ ] **Step 5: Select a note → DEPLOY MISSION**

Check one note, click DEPLOY MISSION.

Expected: Redirected to missions page with briefing pre-filled.

- [ ] **Step 6: Save the mission**

Expected: Mission created, card appears on board as linked card in PLANNED column (STANDBY status).

- [ ] **Step 7: Select 2+ notes → LAUNCH CAMPAIGN**

Check two notes, click LAUNCH CAMPAIGN.

Expected: Redirected to campaign creation with objective pre-filled with both notes' content.

- [ ] **Step 8: Verify real-time updates**

Deploy a mission, watch the board while it runs.

Expected: Card moves through DEPLOYING → IN COMBAT → REVIEWING → ACCOMPLISHED as mission progresses.

- [ ] **Step 9: Commit any fixes found during testing**

```bash
git add -A
git commit -m "fix(intel-board): address issues found during manual testing"
```
