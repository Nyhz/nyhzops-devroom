# Phase E+: Extended Polish — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** E+ (Extended Polish)
**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Four features: URL rename from `/projects` to `/battlefields`, Sonner toast notification system, Dossier Library with 10 codename templates, and LOGISTICS cost/quota dashboard.

---

## E+1. URL Rename: /projects → /battlefields

Rename all route paths from `/projects` to `/battlefields` across the entire app to match the domain language.

### Changes

**Route directory rename:**
- `src/app/projects/` → `src/app/battlefields/`
- All sub-routes follow: `/battlefields/[id]`, `/battlefields/[id]/missions/[missionId]`, etc.
- `/battlefields/new` for creation

**File-level changes (find and replace):**
- All `Link` href props: `/projects/` → `/battlefields/`
- All `router.push('/projects/...)` → `router.push('/battlefields/...)`
- All `redirect('/projects/...)` → `redirect('/battlefields/...)`
- All `revalidatePath('/projects/...)` → `revalidatePath('/battlefields/...)`
- Root page redirect: `redirect('/battlefields')`
- Sidebar navigation links
- Breadcrumb text (keep "Battlefields //" as display text)

**NOT renamed:**
- Database table name (`battlefields`) — already correct
- TypeScript types — already use `Battlefield`
- Server Action function names — already use `createBattlefield` etc.

---

## E+2. Sonner Toast System

### Setup

Install `sonner`. Add `<Toaster>` to root layout.

**Custom theme:**
```typescript
<Toaster
  theme="dark"
  toastOptions={{
    style: {
      background: '#111114',      // dr-surface
      border: '1px solid #2a2a32', // dr-border
      color: '#b8b8c8',           // dr-text
      fontFamily: 'var(--font-tactical), monospace',
    },
  }}
/>
```

### Toast types

- `toast.success('Mission deployed')` — green left border + green dot
- `toast.error('Mission compromised')` — red left border + red dot
- `toast('Saving...')` — amber left border (info/loading)
- `toast.warning('Rate limited')` — amber

### Integration points

Replace ad-hoc success indicators with toasts in:
- Deploy mission form (after save/deploy)
- Battlefield creation (created successfully)
- Campaign actions (launched, saved, plan generated)
- Bootstrap actions (approved, regenerated)
- Config save
- Asset CRUD operations
- Schedule task creation
- Git operations (commit, branch create/delete)
- Abandon mission
- Error states everywhere

---

## E+3. Dossier Library

### Schema

New table `dossiers`:
```
- id              TEXT PRIMARY KEY (ULID)
- codename        TEXT NOT NULL UNIQUE     -- e.g. "NIGHTWATCH"
- name            TEXT NOT NULL            -- e.g. "Unit Test Suite"
- description     TEXT                     -- What this dossier does
- briefingTemplate TEXT NOT NULL           -- Briefing with {{VARIABLE}} placeholders
- variables       TEXT                     -- JSON array of variable definitions
- assetCodename   TEXT                     -- Recommended asset
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

Variable definition shape:
```json
[
  {
    "key": "MODULE_NAME",
    "label": "Module Name",
    "description": "Which module to test (e.g., 'src/lib/auth')",
    "placeholder": "src/lib/auth"
  }
]
```

### Default Dossiers (seeded)

| Codename | Name | Asset | Variables |
|----------|------|-------|-----------|
| NIGHTWATCH | Unit Test Suite | ASSERT | MODULE, COVERAGE_TARGET |
| BLACKSITE | Security Audit | SCANNER | TARGET_AREA, FOCUS_AREAS |
| TRIBUNAL | Code Review | CRITIC | SCOPE, REVIEW_CRITERIA |
| RESUPPLY | Dependency Update | REBASE | UPDATE_SCOPE |
| GHOSTRIDER | Performance Audit | ARCHITECT | TARGET_AREA, METRICS |
| TRIAGE | Bug Fix | ARCHITECT | BUG_DESCRIPTION, REPRODUCTION_STEPS |
| IRONFORGE | Feature Implementation | ARCHITECT | FEATURE_NAME, REQUIREMENTS, CONSTRAINTS |
| ARCHIVE | Documentation Update | DISTILL | SCOPE, AUDIENCE |
| CLEAN SWEEP | Refactor Module | ARCHITECT | MODULE, GOALS |
| WARPAINT | Frontend Component | CANVAS | COMPONENT_NAME, REQUIREMENTS, DESIGN_SPECS |

### Server Actions (`src/actions/dossier.ts`)

- `listDossiers()` — All dossiers, ordered by codename
- `getDossier(id)` — Single dossier
- `createDossier(data)` — Validate codename unique
- `updateDossier(id, data)` — Update fields
- `deleteDossier(id)` — Delete
- `resolveDossier(id, variables: Record<string, string>)` — Replace placeholders with values, return resolved briefing string

### UI: Dossier selector in deploy form

In `src/components/dashboard/deploy-mission.tsx`, add a `[Load Dossier]` button (alongside the existing file dossier loader) that opens a modal:

1. Modal shows all dossiers as cards: codename (amber), name (dim), asset recommendation, variable count
2. Commander clicks one → form appears with one field per variable (label, description, placeholder)
3. Commander fills in → clicks `[APPLY]` → resolved briefing populates the textarea, recommended asset auto-selected

### UI: Dossier management page

Accessible from somewhere (sidebar "DOSSIERS" link or within config). Shows all dossiers, CRUD operations, create custom dossiers.

---

## E+4. LOGISTICS (Cost Dashboard + Rate Limits)

### Per-battlefield costs

**Modify:** Battlefield overview page (`/battlefields/[id]`)

Add a small cost summary below the stats bar:
- Total tokens used (input + output + cache)
- Total cost USD (sum of all missions' costs — already tracked)
- Cache hit rate (already shown in stats bar)

### LOGISTICS page

**New route:** `/logistics`

**New sidebar link:** `◈ LOGISTICS` (between SCHEDULE and CONFIG, or as a top-level nav item)

**Layout:**

**Top: Plan Status (Real-time)**
- Weekly quota: progress bar showing usage vs limit
- Session limit: current session usage
- Resets at: countdown timer
- Source: parsed from `rate_limit_event` data stored in memory or DB

**Middle: Cost Breakdown**
- Per-battlefield table: battlefield codename, total missions, total tokens, total cost USD
- Per-asset table: asset codename, missions completed, total tokens, total cost
- Time period selector: Last 24h / 7 days / 30 days / All time

**Bottom: Usage Over Time**
- Simple bar chart showing daily token usage (CSS-based bars, no heavy chart library)
- Input tokens (one color), output tokens (another), cache hits (third)

### Rate limit tracking

Store the latest `rate_limit_event` data on the Orchestrator (in-memory):

```typescript
// In orchestrator or a separate singleton
interface RateLimitStatus {
  status: string;
  resetsAt: number;
  rateLimitType: string;
  lastUpdated: number;
}
```

The executor already receives `rate_limit_event` from the stream parser. Store the latest one. Expose via a Server Action `getRateLimitStatus()`.

### Intel bar quota indicator

Modify the intel bar to show a small persistent indicator:
```
INTEL // "Quote here..."                    QM: 73% ●
```

`QM` = Quartermaster (legacy reference to LOGISTICS). Green dot if > 50%, amber if 25-50%, red if < 25%. Click opens a tooltip or navigates to `/logistics`.

The percentage comes from the rate limit data. If no data available (no missions run yet), show `QM: — ●` in dim.

### LOGISTICS as a global page

The LOGISTICS page is NOT per-battlefield — it shows costs across ALL battlefields. It's a top-level route like `/logistics`, not nested under `/battlefields/[id]`.

The sidebar shows it as a persistent link (like HQ), not inside the battlefield-scoped navigation.

---

## Execution Order

1. URL rename (`/projects` → `/battlefields`) — must go first
2. Sonner toasts — low dependency, quick
3. Dossier Library — schema + seed + UI
4. LOGISTICS — costs + rate limits + intel bar
