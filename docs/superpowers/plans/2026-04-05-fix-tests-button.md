# Fix Tests Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 1-click "DEPLOY FIX" button to the test runner that creates and queues a mission with the ASSERT asset to fix failing tests.

**Architecture:** A new server action `deployFixMission` in `src/actions/tests.ts` builds a briefing from failing `TestSuiteResult[]` data, looks up the ASSERT asset by codename, and calls the existing `createAndDeployMission`. The test-runner component adds a button that calls this action with the current failing suites.

**Tech Stack:** Next.js Server Actions, Drizzle ORM, React

---

### Task 1: Add `getAssetByCodename` server action

**Files:**
- Modify: `src/actions/asset.ts` (after line 94, below `getAssetDeployment`)
- Test: `src/actions/__tests__/asset.test.ts`

- [ ] **Step 1: Write the failing test**

Add at the bottom of `src/actions/__tests__/asset.test.ts`, inside the outer `describe('asset actions')` block:

```typescript
// ---------------------------------------------------------------------------
// getAssetByCodename
// ---------------------------------------------------------------------------
describe('getAssetByCodename', () => {
  it('returns asset id when codename exists', async () => {
    const asset = createTestAsset(db, { codename: 'STRIKER' });
    const id = await getAssetByCodename('STRIKER');
    expect(id).toBe(asset.id);
  });

  it('returns null when codename does not exist', async () => {
    const id = await getAssetByCodename('NONEXISTENT');
    expect(id).toBeNull();
  });

  it('matches case-insensitively', async () => {
    const asset = createTestAsset(db, { codename: 'RECON' });
    const id = await getAssetByCodename('recon');
    expect(id).toBe(asset.id);
  });
});
```

Also update the import at the top of the file to include `getAssetByCodename`:

```typescript
const { getAssetDeployment, createAsset, updateAsset, toggleAssetStatus, deleteAsset, getAssetByCodename } =
  await import('@/actions/asset');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/actions/__tests__/asset.test.ts --reporter=verbose`
Expected: 3 new tests FAIL with "getAssetByCodename is not a function" or similar.

- [ ] **Step 3: Implement `getAssetByCodename`**

In `src/actions/asset.ts`, add after the `getAssetDeployment` function (after line 94):

```typescript
// ---------------------------------------------------------------------------
// getAssetByCodename — look up asset ID by codename
// ---------------------------------------------------------------------------
export async function getAssetByCodename(codename: string): Promise<string | null> {
  const db = getDatabase();
  const upperCodename = codename.toUpperCase().trim();
  const row = db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.codename, upperCodename))
    .get();
  return row?.id ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/actions/__tests__/asset.test.ts --reporter=verbose`
Expected: All tests PASS including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/actions/asset.ts src/actions/__tests__/asset.test.ts
git commit -m "feat: add getAssetByCodename server action"
```

---

### Task 2: Add `deployFixMission` server action

**Files:**
- Modify: `src/actions/tests.ts` (add new function + import at bottom)

- [ ] **Step 1: Write the failing test**

Create `src/actions/__tests__/tests.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTestDb, closeTestDb } from '@/lib/test/db';
import { createTestBattlefield, createTestAsset } from '@/lib/test/fixtures';
import { createMockDbModule } from '@/lib/test/mock-db';
import type Database from 'better-sqlite3';
import type { TestDB } from '@/lib/test/db';
import type { TestSuiteResult } from '@/types';

let db: TestDB;
let sqlite: Database.Database;

vi.mock('@/lib/db/index', () => createMockDbModule(() => db));

// Mock the mission action to capture calls
const createAndDeployMissionMock = vi.fn().mockResolvedValue({
  id: 'mock-mission-id',
  title: 'Fix Failing Tests',
  status: 'queued',
});

vi.mock('@/actions/mission', () => ({
  createAndDeployMission: (...args: unknown[]) => createAndDeployMissionMock(...args),
}));

const { deployFixMission } = await import('@/actions/tests');

describe('deployFixMission', () => {
  beforeEach(() => {
    const testDb = getTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
    createAndDeployMissionMock.mockClear();
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  it('creates a mission with failing test details in briefing', async () => {
    const bf = createTestBattlefield(db);
    createTestAsset(db, { codename: 'ASSERT' });

    const suites: TestSuiteResult[] = [
      {
        name: 'math.test.ts',
        file: '/repo/src/__tests__/math.test.ts',
        tests: [
          { name: 'adds numbers', status: 'passed', durationMs: 5 },
          {
            name: 'divides by zero',
            status: 'failed',
            durationMs: 3,
            error: { message: 'Expected Infinity but got NaN' },
          },
        ],
      },
    ];

    const result = await deployFixMission(bf.id, suites);
    expect(result).toBe('mock-mission-id');

    expect(createAndDeployMissionMock).toHaveBeenCalledOnce();
    const call = createAndDeployMissionMock.mock.calls[0][0];
    expect(call.battlefieldId).toBe(bf.id);
    expect(call.briefing).toContain('Fix Failing Tests');
    expect(call.briefing).toContain('math.test.ts');
    expect(call.briefing).toContain('divides by zero');
    expect(call.briefing).toContain('Expected Infinity but got NaN');
    // Should NOT include passing tests
    expect(call.briefing).not.toContain('adds numbers');
    // Should have the ASSERT asset
    expect(call.assetId).toBeDefined();
  });

  it('throws when ASSERT asset is not found', async () => {
    const bf = createTestBattlefield(db);

    const suites: TestSuiteResult[] = [
      {
        name: 'foo.test.ts',
        file: '/repo/foo.test.ts',
        tests: [
          { name: 'fails', status: 'failed', durationMs: 1, error: { message: 'bad' } },
        ],
      },
    ];

    await expect(deployFixMission(bf.id, suites)).rejects.toThrow('ASSERT');
  });

  it('filters to only failing suites', async () => {
    const bf = createTestBattlefield(db);
    createTestAsset(db, { codename: 'ASSERT' });

    const suites: TestSuiteResult[] = [
      {
        name: 'passing.test.ts',
        file: '/repo/passing.test.ts',
        tests: [{ name: 'works', status: 'passed', durationMs: 1 }],
      },
      {
        name: 'broken.test.ts',
        file: '/repo/broken.test.ts',
        tests: [
          { name: 'breaks', status: 'failed', durationMs: 1, error: { message: 'oops' } },
        ],
      },
    ];

    await deployFixMission(bf.id, suites);
    const call = createAndDeployMissionMock.mock.calls[0][0];
    expect(call.briefing).toContain('broken.test.ts');
    expect(call.briefing).not.toContain('passing.test.ts');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/actions/__tests__/tests.test.ts --reporter=verbose`
Expected: FAIL — `deployFixMission` is not exported from `@/actions/tests`.

- [ ] **Step 3: Implement `deployFixMission`**

In `src/actions/tests.ts`, add the import at the top:

```typescript
import { createAndDeployMission } from '@/actions/mission';
import { getAssetByCodename } from '@/actions/asset';
```

Then add the function at the bottom of the file (after `getLatestTestRun`):

```typescript
// ---------------------------------------------------------------------------
// deployFixMission — 1-click deploy a mission to fix failing tests
// ---------------------------------------------------------------------------
export async function deployFixMission(
  battlefieldId: string,
  suites: TestSuiteResult[],
): Promise<string> {
  const assetId = await getAssetByCodename('ASSERT');
  if (!assetId) {
    throw new Error('ASSERT asset not found — create an asset with codename ASSERT to use this feature');
  }

  const briefing = buildFixBriefing(suites);

  const mission = await createAndDeployMission({
    battlefieldId,
    briefing,
    assetId,
  });

  return mission.id;
}

function buildFixBriefing(suites: TestSuiteResult[]): string {
  const lines: string[] = [
    '# Fix Failing Tests',
    '',
    'The following tests are failing. Investigate the test files and the source code they exercise, identify the root cause of each failure, and fix them.',
    '',
  ];

  for (const suite of suites) {
    const failedTests = suite.tests.filter((t) => t.status === 'failed');
    if (failedTests.length === 0) continue;

    const fileName = suite.file.split('/').pop() ?? suite.name;
    lines.push(`## ${fileName} (${failedTests.length} ${failedTests.length === 1 ? 'failure' : 'failures'})`);

    for (const test of failedTests) {
      const errorMsg = test.error?.message
        ? ` — ${test.error.message.split('\n')[0].slice(0, 200)}`
        : '';
      lines.push(`- ${test.name}${errorMsg}`);
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/actions/__tests__/tests.test.ts --reporter=verbose`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/tests.ts src/actions/__tests__/tests.test.ts
git commit -m "feat: add deployFixMission server action"
```

---

### Task 3: Add DEPLOY FIX button to test runner UI

**Files:**
- Modify: `src/components/tests/test-runner.tsx`

- [ ] **Step 1: Add the import and handler**

In `src/components/tests/test-runner.tsx`, add the import:

```typescript
import { runTests, abortTestRun, getTestRun, deployFixMission } from '@/actions/tests';
```

Remove the old import line:
```typescript
import { runTests, abortTestRun, getTestRun } from '@/actions/tests';
```

Add a state variable for deploy-in-progress after the existing state declarations (after line 35):

```typescript
const [isDeploying, setIsDeploying] = useState(false);
```

Add the handler after `handleAbort` (after line 122):

```typescript
const handleDeployFix = () => {
  if (!results) return;
  const failingSuites = results.filter((s) => s.tests.some((t) => t.status === 'failed'));
  if (failingSuites.length === 0) return;

  setIsDeploying(true);
  startTransition(async () => {
    try {
      await deployFixMission(battlefieldId, failingSuites);
    } finally {
      setIsDeploying(false);
    }
  });
};
```

- [ ] **Step 2: Add the button to the controls section**

In `src/components/tests/test-runner.tsx`, add the DEPLOY FIX button right after the RE-RUN FAILED button block (after line 175):

```tsx
{hasFailures && !isRunning && (
  <TacButton
    size="sm"
    variant="danger"
    onClick={handleDeployFix}
    disabled={isPending || isDeploying}
  >
    DEPLOY FIX
  </TacButton>
)}
```

- [ ] **Step 3: Build to verify no errors**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/tests/test-runner.tsx
git commit -m "feat: add DEPLOY FIX button to test runner"
```
