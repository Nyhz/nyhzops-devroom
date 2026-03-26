# Phase C3: Campaign Templates — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** C3 (Campaign Templates)
**Date:** 2026-03-26
**Status:** Approved
**Depends on:** Phase C2 (Campaign Execution) — complete

---

## Overview

Phase C3 adds campaign templates: the Commander can save any accomplished or planning campaign as a reusable template, browse templates in a dedicated section, and run a template to create a new pre-filled campaign ready for editing and launch. No schema changes needed — uses existing `isTemplate` and `templateId` fields.

---

## 1. Server Actions

**Modify:** `src/actions/campaign.ts`

### `saveAsTemplate(campaignId: string): Promise<void>`

1. Get campaign, validate status is `accomplished` or `planning`
2. Set `isTemplate = 1` on the campaign record
3. `revalidatePath`

### `runTemplate(templateId: string): Promise<Campaign>`

1. Get template campaign, validate `isTemplate === 1`
2. Clone into a new campaign:
   - New `generateId()` for campaign
   - Same `battlefieldId`, `name` (append " (from template)"), `objective`
   - `status = 'planning'`
   - `templateId` = source template's ID
   - `isTemplate = 0`
3. Clone all phases with new IDs, same `phaseNumber`, `name`, `objective`, `status = 'standby'`
4. Clone all missions with new IDs, same `title`, `briefing`, `assetId`, `priority`, `dependsOn`, `status = 'standby'`
5. `revalidatePath`
6. Return the new campaign

### `listTemplates(battlefieldId: string): Promise<Campaign[]>`

Query campaigns where `battlefieldId` matches AND `isTemplate = 1`. Order by `updatedAt` desc.

---

## 2. UI Changes

### Campaigns List Page (`/projects/[id]/campaigns/page.tsx`)

Add a "TEMPLATES" section below the regular campaign list:

```
CAMPAIGNS                              [+ NEW CAMPAIGN]
┌────────────┐ ┌────────────┐
│ Campaign 1 │ │ Campaign 2 │
└────────────┘ └────────────┘

─────────────────────────────────────────────────

TEMPLATES
┌─────────────────────────────────┐
│ Op. Clean Sweep (template)      │
│ 3 phases · 7 missions           │
│                  [RUN TEMPLATE] │
└─────────────────────────────────┘
```

- Query templates via `listTemplates(battlefieldId)`
- Each template card: name, phase count, mission count, `[RUN TEMPLATE]` button
- `[RUN TEMPLATE]` calls `runTemplate(id)` then redirects to the new campaign's detail page

### Campaign Detail Page

**For template campaigns (`isTemplate === 1`):**
- Show a "TEMPLATE" badge in the header
- Show `[RUN TEMPLATE]` button prominently
- Show the phase timeline (read-only view of the template's plan)
- No LAUNCH button (templates aren't executed directly)

**For all accomplished/planning campaigns:**
- Add `[SAVE AS TEMPLATE]` button (ghost variant) in the controls area
- Calls `saveAsTemplate(campaignId)`
- After saving: show confirmation, page refreshes with TEMPLATE badge

### Campaign Controls Update

Modify `src/components/campaign/campaign-controls.tsx`:
- If `isTemplate`: show `[RUN TEMPLATE]` (primary) instead of status-based controls
- For `accomplished` and `planning` status: add `[SAVE AS TEMPLATE]` button (unless already a template)

---

## 3. What Is NOT Built

- Cross-battlefield templates (templates are scoped to their battlefield)
- Template editing (edit the source campaign's plan, not the template separately)
- Template versioning (no history of template changes)

---

## 4. End State

After C3:
1. Commander can save accomplished or planning campaigns as templates
2. Templates section on campaigns list shows all saved templates
3. `[RUN TEMPLATE]` creates a pre-filled campaign in `planning` status
4. Commander can edit the cloned plan before launching
5. New campaign tracks its source via `templateId`
