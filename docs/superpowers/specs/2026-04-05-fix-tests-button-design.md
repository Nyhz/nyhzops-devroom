# Fix Tests Button — Design Spec

**Date:** 2026-04-05  
**Scope:** Add a 1-click "DEPLOY FIX" button to the test runner that instantly creates and queues a mission with the ASSERT asset to fix failing tests.

## Overview

When tests fail in the test runner panel, a new button appears alongside RE-RUN FAILED. Clicking it builds a briefing from the failing test data and deploys a mission immediately — no dialog, no form, no extra clicks.

## Changes

### 1. Server Action: `getAssetByCodename(codename: string)`

**File:** `src/actions/asset.ts`

New exported server action that looks up an asset by codename and returns its `id` (or `null` if not found). Simple DB query:

```ts
export async function getAssetByCodename(codename: string): Promise<string | null> {
  const db = getDatabase();
  const row = db.select({ id: assets.id })
    .from(assets)
    .where(eq(assets.codename, codename))
    .get();
  return row?.id ?? null;
}
```

### 2. Server Action: `deployFixMission(battlefieldId: string, suites: TestSuiteResult[])`

**File:** `src/actions/tests.ts`

New exported server action that:

1. Calls `getAssetByCodename('ASSERT')` to get the asset ID
2. Builds the briefing string from the failing suites (see Briefing Format below)
3. Calls `createAndDeployMission({ battlefieldId, briefing, assetId })` from `src/actions/mission.ts`
4. Returns the created mission ID

This keeps the briefing construction on the server (no large payloads from client) and reuses existing mission infrastructure.

### 3. UI: "DEPLOY FIX" Button

**File:** `src/components/tests/test-runner.tsx`

Add a new button in the controls section, next to RE-RUN FAILED. Conditions:

- **Visible when:** `hasFailures && !isRunning` (same as RE-RUN FAILED)
- **Disabled when:** `isPending` or deploy is in flight
- **Variant:** `danger` (red styling, matching RE-RUN FAILED)
- **Label:** `DEPLOY FIX`

On click:

1. Filter `results` to suites with at least one failed test
2. Call `deployFixMission(battlefieldId, failingSuites)`
3. Show toast: "Fix mission deployed — QUEUED"

### 4. Briefing Format

The briefing sent to the ASSERT asset:

```markdown
# Fix Failing Tests

The following tests are failing. Investigate the test files and the source code they exercise, identify the root cause of each failure, and fix them.

## telemetry.test.ts (6 failures)
- should track event — Expected 'foo' but received 'bar'
- should flush on shutdown — TypeError: cannot read property 'flush' of undefined

## asset.test.ts (1 failure)
- should validate codename — assertion failed
```

Rules:
- File paths are stripped to relative paths (remove the battlefield working directory prefix)
- Each failing test shows its name and the first line of the error message (truncated to 200 chars)
- Passing/skipped tests within a suite are omitted
- The briefing header gives clear instructions so ASSERT knows what to do

## What This Does NOT Do

- No new UI pages or dialogs
- No new database tables or migrations
- No new Socket.IO events
- No asset creation — reuses existing ASSERT asset

## Files Modified

| File | Change |
|------|--------|
| `src/actions/asset.ts` | Add `getAssetByCodename()` |
| `src/actions/tests.ts` | Add `deployFixMission()` |
| `src/components/tests/test-runner.tsx` | Add DEPLOY FIX button + handler |
