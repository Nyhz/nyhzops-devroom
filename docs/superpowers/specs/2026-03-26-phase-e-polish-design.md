# Phase E: Polish — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** E (Polish)
**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Six independent polish items that improve UX and complete deferred features: asset management with model selection, image paste in briefings, markdown rendering, real-time activity feed, HQ dashboard improvements, and loading skeleton polish.

---

## E1. Asset Management

**Modify:** `src/app/projects/[id]/assets/page.tsx`
**Create:** `src/components/asset/asset-form.tsx` (Client Component)
**Create:** `src/components/asset/asset-card-editable.tsx` (Client Component)
**Create:** `src/actions/asset.ts`

### Server Actions (`src/actions/asset.ts`)

- `createAsset(codename, specialty, systemPrompt, model)` — Insert new asset. Validate codename unique.
- `updateAsset(id, data)` — Update codename, specialty, systemPrompt, model, status.
- `toggleAssetStatus(id)` — Toggle between `active` and `offline`.
- `deleteAsset(id)` — Delete if no missions reference it. Soft-delete by setting `offline` if referenced.

### Model Selection

Model field accepts: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` (the three current Claude models). Display as "Opus", "Sonnet", "Haiku" in the UI.

### Assets Page Update

Replace the read-only grid with editable cards:
- Each card: codename (editable), specialty, model dropdown (Opus/Sonnet/Haiku), status toggle (active/offline dot), missions completed count
- `[EDIT]` button per card → inline edit mode
- `[+ RECRUIT ASSET]` button → opens creation form (modal or inline)
- Creation form: codename, specialty, system prompt (large textarea), model selector

---

## E2. Image Paste in Briefings

**Create:** `src/components/ui/tac-textarea-with-images.tsx` (Client Component)
**Modify:** Deploy mission form, campaign creation, schedule form — anywhere TacTextarea is used for briefings

### Component

Extends TacTextarea with image support:
- `onPaste` handler: detect `clipboardData.items` with `type.startsWith('image/')`, read as base64 via `FileReader`, insert markdown image at cursor: `![screenshot](data:image/png;base64,...)`
- `onDrop` handler: same for drag-and-drop files
- Visual indicator: "Paste or drop images" hint text below textarea
- Preview: inline image preview below the textarea (render base64 images from the markdown)

### Integration

Replace `TacTextarea` with `TacTextareaWithImages` in:
- `src/components/dashboard/deploy-mission.tsx` (briefing field)
- `src/components/schedule/schedule-form.tsx` (mission briefing field)
- Campaign plan editor mission briefings (if practical — may be too complex for inline edit)

---

## E3. Markdown Rendering

**Create:** `src/components/ui/markdown.tsx`
**Install:** `react-markdown` + `remark-gfm` (GitHub Flavored Markdown)

### Component

```typescript
interface MarkdownProps {
  content: string;
  className?: string;
}
```

Renders markdown with tactical styling:
- Headers: amber, tactical font
- Code blocks: `bg-dr-bg font-data` with border
- Inline code: `bg-dr-elevated` with subtle border
- Links: `text-dr-blue` underlined
- Lists: dim bullets/numbers
- Tables: bordered with `bg-dr-surface`
- Images: rendered inline (supports base64 from image paste)

### Integration

Replace `whitespace-pre-wrap` rendering with `<Markdown>` in:
- Mission detail briefing section
- Mission debrief display
- Campaign phase debriefs
- Bootstrap review CLAUDE.md/SPEC.md preview

---

## E4. Activity Feed

**Create:** `src/components/dashboard/activity-feed.tsx` (Client Component)
**Create:** `src/hooks/use-activity-feed.ts`

### Hook

Subscribes to `hq:activity` Socket.IO room. Collects `activity:event` events into a rolling list (max 50 items).

```typescript
function useActivityFeed(): ActivityEvent[] {
  // Subscribe to hq:activity
  // Listen for activity:event
  // Maintain rolling list
}

interface ActivityEvent {
  type: string;
  battlefieldCodename: string;
  missionTitle: string;
  timestamp: number;
  detail: string;
}
```

### Component

Real-time scrolling feed showing recent operations:
- Each entry: timestamp (dim) + type icon + battlefield codename (amber) + mission title + detail
- Auto-scrolls to latest
- Type icons: deploying (⟳), in_combat (⚔), accomplished (✓), compromised (✗), abandoned (—)
- Max 50 items, oldest dropped

### Integration

Add to the battlefield overview page (sidebar or below mission list) and the HQ projects page.

---

## E5. HQ Dashboard Improvements

**Modify:** `src/app/projects/page.tsx`

The projects list page becomes the HQ:
- Keep the battlefield grid
- Add global stats bar: total missions in combat, total accomplished (across all battlefields), total active agents
- Add the activity feed component below the battlefield grid
- Add "Recent Missions" quick list (last 10 missions across all battlefields with status + links)

---

## E6. Loading Skeletons Polish

**Modify:** Various `loading.tsx` files

Ensure every route segment has a proper loading skeleton:

| Route | Skeleton |
|-------|----------|
| `/projects` | Grid of pulsing card placeholders |
| `/projects/[id]` | Header + stats bar + mission list skeleton |
| `/projects/[id]/campaigns` | Grid of pulsing cards |
| `/projects/[id]/campaigns/[id]` | Phase timeline skeleton |
| `/projects/[id]/assets` | Grid of asset cards skeleton |
| `/projects/[id]/git` | Tab content skeleton |
| `/projects/[id]/console` | Panel + terminal skeleton |
| `/projects/[id]/schedule` | Task list skeleton |
| `/projects/[id]/config` | Form fields skeleton |

Each skeleton: `bg-dr-elevated animate-pulse` bars of varying widths on `bg-dr-surface` background. Match the approximate layout of the actual content.
