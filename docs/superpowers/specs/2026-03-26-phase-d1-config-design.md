# Phase D1: Battlefield Configuration — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** D1 (Config)
**Date:** 2026-03-26
**Status:** Approved
**Depends on:** Phase C3 — complete

---

## Overview

Replace the config stub page with a battlefield settings editor. The Commander can edit battlefield properties, manage CLAUDE.md/SPEC.md paths, configure the dev server, and trigger re-bootstrap.

---

## 1. Config Page

**Replace:** `src/app/projects/[id]/config/page.tsx`

Server Component with `await params`. Queries battlefield by ID.

### Layout

**Editable fields:**
- Name (TacInput)
- Codename (TacInput)
- Description (TacInput)
- Initial Briefing (TacTextarea, large — editable for re-bootstrap)
- Default branch (TacInput)
- Dev server command (TacInput, default: `npm run dev`)
- Auto-start dev server (checkbox toggle)

**Read-only fields:**
- Repo path (displayed, not editable)

**File path fields:**
- CLAUDE.md path (TacInput + `[PREVIEW]` button)
- SPEC.md path (TacInput + `[PREVIEW]` button)
- PREVIEW opens a modal with the file content (read from disk via `readBootstrapFile` or similar)

**Actions:**
- `[SAVE]` (success) — calls `updateBattlefield` Server Action with all editable fields
- `[RE-BOOTSTRAP]` (primary) — confirmation dialog, then calls `regenerateBootstrap` (already exists from B3) with the current initial briefing. Transitions battlefield back to `initializing`.

### Client Component

The form needs interactivity (input state, save handler, preview modal). Extract a `<ConfigForm>` Client Component that receives initial battlefield data as props.

---

## 2. Server Actions

All already exist:
- `updateBattlefield` from `src/actions/battlefield.ts` — already handles all editable fields
- `regenerateBootstrap` from `src/actions/battlefield.ts` — re-runs bootstrap
- `readBootstrapFile` from `src/actions/battlefield.ts` — reads CLAUDE.md/SPEC.md from disk

No new Server Actions needed.

---

## 3. Preview Modal

When Commander clicks `[PREVIEW]` on CLAUDE.md or SPEC.md:
- Read file content via `readBootstrapFile(battlefieldId, filename)`
- Show in a TacModal with `whitespace-pre-wrap font-data` content
- Scrollable, read-only

---

## 4. End State

- Config page shows all battlefield settings
- Commander can edit and save
- RE-BOOTSTRAP triggers a fresh bootstrap run
- CLAUDE.md/SPEC.md content previewable in a modal
