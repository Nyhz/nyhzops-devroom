# Testing — Strategy & Conventions

DEVROOM employs a three-layer testing strategy. Each layer targets a different scope and failure mode.

---

## Test Layers

| Layer | Tool | Scope | Runs In |
|-------|------|-------|---------|
| **Server Action / Unit** | Vitest | Actions, hooks, utilities — business logic with in-memory DB | Node.js |
| **Component** | Vitest + Testing Library | UI components — rendering, interactions, state | jsdom |
| **E2E** | Playwright | Full flows — browser against live dev server | Chromium |

---

## File Location Conventions

```
src/actions/__tests__/*.test.ts                  Server Action tests
src/components/<category>/__tests__/*.test.tsx   Component tests
src/hooks/__tests__/*.test.ts                    Hook tests
src/lib/<module>/__tests__/*.test.ts             Library module tests
src/lib/utils/__tests__/*.test.ts                Utility tests
src/app/api/__tests__/*.test.ts                  API route guard tests
e2e/*.spec.ts                                    E2E browser tests
e2e/fixtures.ts                                  E2E fixture data
e2e/helpers.ts                                   E2E helper utilities
```

Test files are colocated with the code they test via `__tests__/` directories. E2E specs live at the project root in `e2e/`. Library modules (`orchestrator`, `overseer`, `quartermaster`, `discovery`, `socket`) each have their own `__tests__/` directory for unit tests.

---

## Running Tests

| Command | Action |
|---------|--------|
| `pnpm test` | Run all Vitest tests (actions, components, hooks, utils) |
| `pnpm test:watch` | Run Vitest in watch mode |
| `pnpm test:e2e` | Run Playwright E2E tests (requires dev server) |
| `pnpm test:e2e:ui` | Run E2E tests with Playwright's visual UI |

E2E tests auto-start the dev server via `playwright.config.ts` if one isn't already running on port 3000.

---

## Test Infrastructure

### Test Database (`src/lib/test/db.ts`)

`getTestDb()` returns a fresh in-memory SQLite instance with all schema tables created from Drizzle column metadata. Each call is fully isolated — no state leaks between tests.

```ts
import { getTestDb, closeTestDb } from '@/lib/test/db';

let db: TestDB;
let sqlite: Database.Database;

beforeEach(() => {
  ({ db, sqlite } = getTestDb());
});

afterEach(() => {
  closeTestDb(sqlite);
});
```

Action tests mock `@/lib/db` to inject the test database:

```ts
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}));

// In beforeEach:
vi.mocked(getDatabase).mockReturnValue(db);
```

### Fixtures (`src/lib/test/fixtures.ts`)

Factory functions for all entities. Each accepts partial overrides and returns the inserted record.

| Factory | Required Params |
|---------|----------------|
| `createTestBattlefield(db, overrides?)` | — |
| `createTestMission(db, { battlefieldId, ...overrides })` | `battlefieldId` |
| `createTestCampaign(db, { battlefieldId, ...overrides })` | `battlefieldId` |
| `createTestPhase(db, { campaignId, ...overrides })` | `campaignId` |
| `createTestAsset(db, overrides?)` | — |
| `createTestDossier(db, overrides?)` | — |
| `createTestIntelNote(db, { battlefieldId, ...overrides })` | `battlefieldId` |
| `createTestFollowUpSuggestion(db, { missionId, ...overrides })` | `missionId` |
| `createTestNotification(db, overrides?)` | — |
| `createTestOverseerLog(db, { battlefieldId, missionId, ...overrides })` | `battlefieldId`, `missionId` |
| `createTestBriefingSession(db, { campaignId, ...overrides })` | `campaignId` |
| `createTestBriefingMessage(db, { sessionId, ...overrides })` | `sessionId` |
| `createTestGeneralSession(db, overrides?)` | — |
| `createTestGeneralMessage(db, { sessionId, ...overrides })` | `sessionId` |

### Global Mocks

**`src/lib/test/setup.ts`** — loaded for all tests. Mocks:
- `next/cache` — `revalidatePath`, `revalidateTag` as no-ops
- `next/headers` — `cookies`, `headers` returning empty Maps
- `globalThis.orchestrator` — all methods as `vi.fn()` no-ops
- `globalThis.io` — Socket.IO `emit`/`to`/`in` chain as no-ops

**`src/lib/test/component-setup.ts`** — loaded for all tests (harmless in node env). Adds:
- `@testing-library/jest-dom/vitest` matchers (`.toBeInTheDocument()`, etc.)
- Auto-cleanup after each test
- `next/navigation` mocks (`useRouter`, `useParams`, `usePathname`, etc.)
- `next/link` mock as plain `<a>` tag
- Socket.IO provider and `useSocket` hook mocks

### Render Utility (`src/lib/test/render.tsx`)

`renderWithProviders(ui, options?)` wraps Testing Library's `render` with a pre-configured `userEvent.setup()` instance:

```ts
import { renderWithProviders } from '@/lib/test/render';

const { user, getByRole } = renderWithProviders(<MyComponent />);
await user.click(getByRole('button'));
```

---

## Writing New Tests

### Server Action Test Template

```ts
// src/actions/__tests__/example.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, closeTestDb, type TestDB } from '@/lib/test/db';
import { createTestBattlefield } from '@/lib/test/fixtures';
import Database from 'better-sqlite3';

// Mock the DB module to inject test database
const { getDatabase } = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getDatabase }));

// Import the action AFTER mocking
const { myAction } = await import('@/actions/example');

describe('myAction', () => {
  let db: TestDB;
  let sqlite: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, sqlite } = getTestDb());
    vi.mocked(getDatabase).mockReturnValue(db);
  });

  afterEach(() => {
    closeTestDb(sqlite);
  });

  it('does the thing', () => {
    const bf = createTestBattlefield(db);
    const result = myAction(bf.id);
    expect(result).toBeDefined();
  });

  it('throws on invalid input', () => {
    expect(() => myAction('nonexistent')).toThrow();
  });
});
```

### Component Test Template

```tsx
// src/components/example/__tests__/my-component.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render';
import { MyComponent } from '../my-component';

// Mock server actions used by the component
vi.mock('@/actions/example', () => ({
  myAction: vi.fn(),
}));

describe('MyComponent', () => {
  it('renders content', () => {
    const { getByText } = renderWithProviders(
      <MyComponent data={mockData} />
    );
    expect(getByText('Expected Text')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const { user, getByRole } = renderWithProviders(
      <MyComponent data={mockData} />
    );
    await user.click(getByRole('button', { name: 'Submit' }));
    expect(vi.mocked(myAction)).toHaveBeenCalled();
  });
});
```

Component test files must include `// @vitest-environment jsdom` at the top to run in a browser-like environment.

### E2E Test Template

```ts
// e2e/example.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Example Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Bypass War Room boot animation
    await page.addInitScript(() => {
      sessionStorage.setItem('devroom-booted', 'true');
    });
  });

  test('completes the flow', async ({ page }) => {
    await page.goto('/target-page');
    await page.getByRole('button', { name: 'Action' }).click();
    await expect(page.getByText('Success')).toBeVisible();
  });
});
```

E2E tests run against the live dev server. The War Room boot animation must be bypassed via `sessionStorage` injection. Test data can be seeded via test fixture API routes (guarded by `NODE_ENV !== 'production'`).

---

## Test Coverage Summary

### Server Action Tests (15 files)

| File | Tests | Actions Covered |
|------|-------|----------------|
| `battlefield.test.ts` | 41 | createBattlefield, getBattlefield, listBattlefields, updateBattlefield, archiveBattlefield, deleteBattlefield, approveBootstrap, regenerateBootstrap, abandonBootstrap, writeBootstrapFile, readBootstrapFile |
| `mission.test.ts` | 55 | createMission, createAndDeployMission, getMission, listMissions, deployMission, abandonMission, continueMission, removeMission |
| `campaign.test.ts` | 74 | createCampaign, getCampaign, listCampaigns, updateCampaign, deleteCampaign, backToDraft, updateBattlePlan, launchCampaign, completeCampaign, abandonCampaign, redeployCampaign, saveAsTemplate, runTemplate, listTemplates, resumeCampaign, skipAndContinueCampaign, tacticalOverride, commanderOverride, skipMission |
| `asset.test.ts` | 27 | createAsset, updateAsset, toggleAssetStatus, deleteAsset, getAssetDeployment |
| `dossier.test.ts` | 32 | createDossier, listDossiers, getDossier, updateDossier, deleteDossier, resolveDossier |
| `git.test.ts` | 21 | getGitStatus, stageFile, unstageFile, stageAll, unstageAll, commitChanges, getGitLog, getBranches, checkoutBranch, deleteBranch, createBranch, getFileDiff |
| `intel.test.ts` | 32 | createNote, getNote, updateNote, deleteNote, moveNote, linkNoteToMission, linkNotesToCampaign, listBoardNotes, backfillIntelNotes |
| `follow-up.test.ts` | 20 | extractAndSaveSuggestions, addSuggestionToBoard, dismissSuggestion, getSuggestions |
| `notification.test.ts` | 13 | getNotifications, markNotificationRead, markAllRead, getUnreadCount |
| `logistics.test.ts` | 13 | getGlobalStats, getCostByBattlefield, getCostByAsset, getDailyUsage, getRateLimitStatus |
| `overseer.test.ts` | 8 | getOverseerLogs, getOverseerStats |
| `briefing.test.ts` | 6 | getBriefingSession, getBriefingMessages |
| `general.test.ts` | 11 | createGeneralSession, closeGeneralSession, renameGeneralSession, getActiveSessions, getSessionMessages |
| `console.test.ts` | 21 | startDevServer, stopDevServer, restartDevServer, getDevServerStatus, runConsoleCommand, getPackageScripts, getCommandLog |
| `schedule.test.ts` | 24 | createScheduledTask, updateScheduledTask, deleteScheduledTask, listScheduledTasks, toggleScheduledTask, getScheduledMissionHistory |

### Library Module Tests (8 files)

| File | Tests | Module |
|------|-------|--------|
| `orchestrator/asset-cli.test.ts` | 11 | Asset CLI argument builder — skills, MCP servers, effort, max turns |
| `orchestrator/phase-guard.test.ts` | 5 | Phase completion guards and transition validation |
| `orchestrator/safe-queue.test.ts` | 6 | Mission queue concurrency and ordering |
| `overseer/review-parser.test.ts` | 17 | Parse Overseer verdict output (approve/retry/escalate) |
| `quartermaster/quartermaster.test.ts` | 4 | Merge orchestration and follow-up extraction |
| `socket/emit.test.ts` | 10 | Centralized status emitter — room resolution, revalidation |
| `discovery/skill-scanner.test.ts` | 7 | Claude Code plugin skill scanning |
| `utils/dependency-graph.test.ts` | 9 | Mission dependency graph resolution |

### Component Tests

| Category | Tests | Components |
|----------|-------|-----------|
| UI Primitives | 81 | TacButton, TacInput, TacTextarea, TacSelect, TacCard, TacBadge, Modal, TacTextareaWithImages, SearchInput, InlineErrorPanel |
| Battlefield | 63 | CreateBattlefield, BootstrapReview, BootstrapComms, BootstrapError, ScaffoldOutput, ScaffoldRetry |
| Dashboard | 46 | DeployMission, MissionList, StatsBar, ActivityFeed |
| Mission | 50 | MissionActions, LiveStatusBadge, MissionComms |
| Campaign | 62 | CampaignControls, PlanEditor, PhaseTimeline, MissionCard, PlanEditorUtils |
| Shared | 15 | BattlefieldSelector, ActivityFeed |
| Hooks | 34 | useSocket, useNotifications, useBoard |
| Utils | 13 | debriefParser, dependencyGraph |

### API Route Tests (1 file)

| File | Tests | Coverage |
|------|-------|----------|
| `test-seed-guard.test.ts` | 4 | Production guard on test seed endpoints |

### E2E Tests (7 specs)

| Spec | Tests | Flow |
|------|-------|------|
| `smoke.spec.ts` | 2 | App loads, title and content verification |
| `battlefield.spec.ts` | 7 | Create battlefield (form validation, link mode, bootstrap, codename, mode toggle) |
| `mission.spec.ts` | 6 | Create mission (deploy, save, detail page, actions, validation, abandon) |
| `campaign.spec.ts` | 14 | Create campaign + plan editor (form, phases, missions, save, priority, objectives) |
| `campaign-execution.spec.ts` | 20 | Campaign lifecycle (launch, monitoring, overrides, abandon, completion) |
| `campaign-interactions.spec.ts` | 13 | Campaign controls, phase interactions, stall/resume flows |
| `ui-components.spec.ts` | 19 | UI primitive rendering, interactions, accessibility checks |

E2E tests use shared helpers (`e2e/fixtures.ts`, `e2e/helpers.ts`) for data seeding and common page operations.

### Test Seeding Infrastructure

E2E and manual testing are supported by seed API routes:

| Route | Purpose |
|-------|---------|
| `/api/test/seed-campaign` | Seed a campaign with phases and missions |
| `/api/test/seed-active-campaign` | Seed a campaign in active state with running missions |
| `/api/test-fixtures` | Generic fixture seeding endpoint |

All seed routes are guarded by `NODE_ENV !== 'production'` checks (tested in `test-seed-guard.test.ts`).

### Test Harness

A dedicated test harness page exists at `/(hq)/test-harness` for manual UI component testing and visual verification during development.

---

## Rules of Engagement

1. **All new Server Actions must have corresponding tests.** Cover success paths, validation errors, and not-found cases.
2. **All new interactive components should have component tests.** Cover rendering, user interactions, and error states.
3. **Critical user flows should have E2E coverage.** If a Commander can break it by clicking, it needs an E2E test.
4. **Test files follow the `__tests__/` convention.** No test files outside of `__tests__/` directories (except E2E in `e2e/`).
5. **Use fixtures, not inline data.** Factory functions ensure consistency and reduce test boilerplate.
6. **Clean up after yourself.** Always call `closeTestDb(sqlite)` in `afterEach`. E2E tests must delete seeded data in `afterAll`.
