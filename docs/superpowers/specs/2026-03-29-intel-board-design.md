# Intel Board — Per-Battlefield Kanban

## Summary

A per-battlefield Kanban board that serves as a planning scratchpad and live mission tracker. Notes are lightweight cards created on the board. They can be promoted to standalone missions or bundled into campaigns via the existing creation flows. All battlefield missions — regardless of origin — appear on the board as linked cards that auto-move through columns based on real-time status updates.

New sidebar nav entry: **INTEL BOARD**, sitting between CAMPAIGNS and GIT.

## Terminology

| Term | Meaning |
|------|---------|
| **Intel Note** | A lightweight card on the board. Has a title and optional markdown description. |
| **Linked Card** | An intel note that has been promoted to a mission (or auto-created for a mission). Driven by mission status. |
| **Unpromoted Note** | An intel note with no linked mission. Manually draggable. |

## Data Model

### New Table: `intel_notes`

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- title           TEXT NOT NULL
- description     TEXT                     -- markdown body
- column          TEXT DEFAULT 'backlog'   -- 'backlog' | 'planned' (manual position, only used when unpromoted)
- position        INTEGER DEFAULT 0        -- sort order within column
- missionId       TEXT REFERENCES missions(id)   -- set on promotion → becomes linked card
- campaignId      TEXT REFERENCES campaigns(id)  -- set if promoted via campaign launch
- createdAt       INTEGER NOT NULL         -- unix ms
- updatedAt       INTEGER NOT NULL
```

**Key behaviors:**

- `column` and `position` are only meaningful for unpromoted notes (no `missionId`).
- Once `missionId` is set, the card's column is derived from the linked mission's status — `column` field is ignored.
- Missions created outside the board (deploy form, campaign-spawned) get an `intel_notes` row auto-created with `missionId` pre-set so they appear on the board immediately.

## Column Structure

Seven fixed columns mapped to the mission lifecycle:

| Column | Cards Shown |
|--------|-------------|
| **BACKLOG** | Unpromoted notes with `column = 'backlog'` |
| **PLANNED** | Unpromoted notes with `column = 'planned'` + linked missions with status `standby` or `queued` |
| **DEPLOYING** | Linked missions with status `deploying` |
| **IN COMBAT** | Linked missions with status `in_combat` |
| **REVIEWING** | Linked missions with status `reviewing` |
| **ACCOMPLISHED** | Linked missions with status `accomplished` |
| **COMPROMISED** | Linked missions with status `compromised` |

Missions with status `abandoned` are hidden by default. Optional toggle to show them dimmed.

## Card Types

### Unpromoted Note

- **Appearance:** Dim white left border. Title + relative age ("3d ago").
- **Interaction:** Draggable between Backlog and Planned. Reorder within column.
- **Click:** Opens right slide-out panel with:
  - Editable title
  - Editable markdown description
  - Created date
  - Actions: "DEPLOY MISSION", "LAUNCH CAMPAIGN", "DELETE"
- **Selection:** Checkbox on hover for multi-select.

### Linked Card (mission)

- **Appearance:** Color-coded left border matching status. Title, asset codename, relative timestamp. Pulsing dot for IN COMBAT.
- **Interaction:** Not manually draggable — position driven by mission status via Socket.IO.
- **Click:** Navigates to mission detail page (`/battlefields/[id]/missions/[missionId]`).
- **Selection:** Not selectable (already a mission).

## Interactions

### Create Note

"+ NEW NOTE" button in header bar opens the side panel in create mode. Title is required, description is optional (markdown). New notes land in BACKLOG at position 0 (top).

### Drag & Drop

- Unpromoted notes drag freely between BACKLOG and PLANNED.
- Reordering within a column updates `position` values.
- Linked cards cannot be dragged — they are locked to their status-derived column.

### Promote: Single Note → Standalone Mission

1. Select one note (checkbox) → "DEPLOY MISSION" button activates in the header bar.
2. Click → redirects to the battlefield missions page with the deploy form pre-filled:
   - Briefing textarea populated with the note's title (as heading) + description.
3. On mission creation (save or save & deploy), a server action sets the note's `missionId` to the new mission ID.
4. The note becomes a linked card and auto-moves to the appropriate column.

### Promote: Multi-Select → Campaign

1. Select 2+ notes (checkboxes) → "LAUNCH CAMPAIGN" button activates.
2. Click → redirects to campaign creation page (`/battlefields/[id]/campaigns/new`) with the briefing pre-filled:
   - Structured markdown listing each selected note's title and description.
   - GENERAL handles phase planning, dependency analysis, and mission decomposition from there.
3. On campaign creation, each selected note gets `campaignId` set immediately. Since GENERAL may reorganize notes into different missions (splitting, combining, reordering into phases), notes are not auto-linked to specific missions at this point.
4. Once the campaign plan is finalized and missions are created, the Commander can manually link remaining notes to missions from the board's side panel — or leave them linked only at the campaign level. Notes with `campaignId` but no `missionId` show in the PLANNED column with a campaign badge.
5. As campaign missions complete, any linked notes auto-move through columns as expected.

### Single Note → Campaign

Selecting a single note also shows the "LAUNCH CAMPAIGN" option alongside "DEPLOY MISSION", giving the Commander the choice of either path.

### Auto-Creation for External Missions

When a mission is created through any other flow (deploy form, campaign execution, scheduled task), a corresponding `intel_notes` row is auto-created:
- `title` = mission title
- `description` = null (briefing lives on the mission record; no duplication)
- `missionId` = the new mission's ID
- `campaignId` = the mission's campaign ID if applicable

This ensures every mission in the battlefield appears on the board without manual action.

## Real-Time Updates

### Socket.IO Events

The board subscribes to the existing `mission:status` event stream. When a mission's status changes:

1. Find the corresponding linked card on the board.
2. Animate the card sliding from its current column to the new status-derived column.
3. Update the card's visual styling (border color, status label, pulsing indicator).

No new Socket.IO events needed — the existing `mission:status` events already carry `missionId` and `status`.

## UI Structure

### Navigation

New entry in `sidebar-nav.tsx`:

```
{ icon: "⊞", label: "INTEL BOARD", segment: "board" }
```

Positioned between CAMPAIGNS and GIT.

### Page Layout

Route: `/battlefields/[id]/board`

```
┌─────────────────────────────────────────────────────────┐
│ CODENAME                                                │
│ INTEL BOARD                                             │
│ Battlefield description                                 │
├─────────────────────────────────────────────────────────┤
│ ⊞ INTEL BOARD  14 cards · 3 active   [+ NOTE] [ACTIONS]│
├────────┬────────┬─────────┬──────────┬────────┬─────────┤
│BACKLOG │PLANNED │DEPLOYING│IN COMBAT │REVIEW  │ACCOMP.  │
│        │        │         │          │        │         │
│ card   │ card   │ card    │ card ●   │ card   │ card    │
│ card   │ card   │         │ card ●   │        │ card    │
│ card   │        │         │          │        │         │
│        │        │         │          │        │         │
└────────┴────────┴─────────┴──────────┴────────┴─────────┘
```

### Side Panel

Right slide-out panel (overlays board, ~400px wide) for note detail/edit:

- Header: title (editable inline)
- Body: markdown editor for description
- Footer: created date, action buttons
- Close on Escape or click outside

### Header Action Bar

Context-sensitive based on selection:

| State | Buttons |
|-------|---------|
| 0 selected | "+ NEW NOTE" active, action buttons dimmed |
| 1 selected | "+ NEW NOTE", "DEPLOY MISSION", "LAUNCH CAMPAIGN" all active |
| 2+ selected | "+ NEW NOTE", "LAUNCH CAMPAIGN" active, "DEPLOY MISSION" dimmed |

## Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| `src/lib/db/migrations/XXXX_intel_notes.sql` | Migration for `intel_notes` table |
| `src/actions/intel.ts` | Server actions: CRUD notes, promote, reorder |
| `src/app/(hq)/battlefields/[id]/board/page.tsx` | Board page (Server Component — fetches initial data) |
| `src/app/(hq)/battlefields/[id]/board/loading.tsx` | Skeleton loader |
| `src/components/board/intel-board.tsx` | Main board client component (columns, drag-drop, Socket.IO) |
| `src/components/board/board-card.tsx` | Card component (note vs linked variants) |
| `src/components/board/board-column.tsx` | Column component (header, card list, drop zone) |
| `src/components/board/note-panel.tsx` | Right slide-out panel for note detail/edit |
| `src/hooks/use-board.ts` | Board state management + Socket.IO subscription |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `intelNotes` table definition |
| `src/components/layout/sidebar-nav.tsx` | Add INTEL BOARD nav entry |
| `src/actions/mission.ts` | On mission creation, auto-create `intel_notes` row |
| `src/actions/campaign.ts` | On campaign mission creation, auto-create/link `intel_notes` rows |
| `src/types/index.ts` | Add `IntelNote`, `IntelNoteWithMission` types |

## What Doesn't Change

- **Missions page:** Deploy form, stats bar, mission list, search — all untouched.
- **Campaign creation flow:** Unchanged, just receives pre-filled briefing text via URL params or form state.
- **Mission detail page:** Unchanged. Board cards link to it.
- **Campaign detail page:** Unchanged.
- **Orchestrator/executor:** No changes. Missions are created and executed the same way.

## Drag-and-Drop Library

Use `@hello-pangea/dnd` (maintained fork of `react-beautiful-dnd`). Lightweight, well-tested, supports horizontal board + vertical card lists. Already compatible with React 18+ and Next.js App Router.
