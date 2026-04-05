# Shared Rules of Engagement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the baked-in `RULES_OF_ENGAGEMENT` constant with a runtime-composed shared prompt stored in a new `settings` table, editable from a new tab on `/assets`, applied to mission assets only.

**Architecture:** New key/value `settings` table seeded with the current ROE text. `buildAssetCliArgs()` prepends the stored ROE to `asset.systemPrompt` only when `isSystem === 0`. A new `RULES OF ENGAGEMENT` tab on `/assets` edits the row via a Server Action. Existing mission-asset rows have their baked-in ROE prefix stripped by the migration. The seed script no longer concatenates ROE into asset prompts.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, better-sqlite3, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-05-shared-rules-of-engagement-design.md`

---

## File Structure

**New files**
- `src/lib/settings/default-rules-of-engagement.ts` — exports `DEFAULT_RULES_OF_ENGAGEMENT` (the exact current text) and `LEGACY_ROE_PREFIX` (same text plus the `\n\n` separator) — single source of truth used by migration, seed, and tests.
- `src/lib/settings/rules-of-engagement.ts` — runtime reader `getRulesOfEngagement()` that queries the `settings` table synchronously with a module-level cache and a test seam `__setRulesOfEngagementOverride(value | null)`.
- `src/actions/settings.ts` — Server Actions `getRulesOfEngagementAction()` and `updateRulesOfEngagementAction(value: string)`.
- `src/actions/__tests__/settings.test.ts` — tests for the Server Action.
- `src/components/settings/rules-of-engagement-editor.tsx` — Client Component with textarea + SAVE button.
- `src/lib/db/migrations/0020_shared_roe.sql` — hand-written migration (create table, seed row, strip prefix from mission assets).
- `src/lib/db/migrations/meta/0020_snapshot.json` — drizzle-kit generated.

**Modified files**
- `src/lib/db/schema.ts` — add `settings` table definition.
- `src/lib/db/migrations/meta/_journal.json` — new entry for 0020 (drizzle-kit updates this).
- `src/lib/orchestrator/asset-cli.ts` — prepend ROE for `isSystem: 0` assets.
- `src/lib/orchestrator/__tests__/asset-cli.test.ts` — 3 new test cases.
- `scripts/seed.ts` — remove `RULES_OF_ENGAGEMENT` constant and concatenation; seed `settings` row.
- `src/app/(hq)/assets/page.tsx` — wrap roster content in a tabbed layout.
- `.devroom/spec-prompts.md` — update the Rules of Engagement section.
- `.devroom/spec-missions.md` — one-line reference update.

---

## Task 1: Extract default ROE text to a shared constant

**Files:**
- Create: `src/lib/settings/default-rules-of-engagement.ts`

- [ ] **Step 1: Create the constants file**

```ts
// src/lib/settings/default-rules-of-engagement.ts
/**
 * The default Rules of Engagement text, seeded into the `settings` table.
 * Also used by the 0020 migration to detect and strip the legacy baked-in prefix
 * from existing mission asset rows.
 */
export const DEFAULT_RULES_OF_ENGAGEMENT = `You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.

RULES OF ENGAGEMENT:
1. MISSION SCOPE IS ABSOLUTE. Execute exactly what the briefing describes. Nothing more. Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice. If it is not in the briefing, it does not exist.
2. REPORT, DON'T FIX. If you encounter issues outside your scope, log them in your debrief under "Recommended Next Actions." The Commander decides follow-ups.
3. SPEED AND PRECISION. Minimal file reads — only what you need. Surgical edits — only the lines that matter.
4. COMMIT DISCIPLINE. Commit with clear, descriptive messages. Only commit files related to your mission.
5. DEBRIEF IS MANDATORY. On completion, provide a debrief to the Commander:
   - What was done (precise changes)
   - What changed (files modified)
   - Risks (anything that could break)
   - ## Recommended Next Actions (bullet list of follow-up tasks)`;

/**
 * Exact text that the old seed script prepended to each mission asset's systemPrompt.
 * Used by the 0020 migration to strip the legacy prefix.
 * Must match `RULES_OF_ENGAGEMENT + '\n\n'` from the old scripts/seed.ts byte-for-byte.
 */
export const LEGACY_ROE_PREFIX = DEFAULT_RULES_OF_ENGAGEMENT + '\n\n';
```

- [ ] **Step 2: Verify text matches the current seed constant exactly**

Run: `diff <(sed -n '14,25p' scripts/seed.ts) <(node -e "console.log(require('./src/lib/settings/default-rules-of-engagement.ts').DEFAULT_RULES_OF_ENGAGEMENT)") || true`

(If the above is awkward, open both files side by side and confirm byte-for-byte equivalence of the ROE block. The migration's strip step depends on this.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings/default-rules-of-engagement.ts
git commit -m "feat(settings): extract default rules of engagement constant"
```

---

## Task 2: Add `settings` table to the Drizzle schema

**Files:**
- Modify: `src/lib/db/schema.ts` (append after the last table, before any relations)

- [ ] **Step 1: Add the table definition**

Append at the end of `src/lib/db/schema.ts`:

```ts
// ---------------------------------------------------------------------------
// Settings — global key/value configuration (single row per key)
// ---------------------------------------------------------------------------
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm drizzle-kit generate`

Expected: creates `src/lib/db/migrations/0020_<some_name>.sql` and `src/lib/db/migrations/meta/0020_snapshot.json`, and appends an entry to `_journal.json`.

- [ ] **Step 3: Rename the generated migration file to a stable name**

```bash
mv src/lib/db/migrations/0020_*.sql src/lib/db/migrations/0020_shared_roe.sql
```

Then update the `tag` field for idx 20 in `src/lib/db/migrations/meta/_journal.json` to `"0020_shared_roe"`.

- [ ] **Step 4: Verify the build compiles**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations/0020_shared_roe.sql src/lib/db/migrations/meta/0020_snapshot.json src/lib/db/migrations/meta/_journal.json
git commit -m "feat(db): add settings table for global key/value config"
```

---

## Task 3: Extend the migration with seed + legacy strip

**Files:**
- Modify: `src/lib/db/migrations/0020_shared_roe.sql`

- [ ] **Step 1: Append seed + strip SQL to the generated migration**

Open `src/lib/db/migrations/0020_shared_roe.sql`. After the `CREATE TABLE settings` statement, append:

```sql
--> statement-breakpoint
INSERT INTO settings (key, value, updated_at)
VALUES (
  'rules_of_engagement',
  'You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.

RULES OF ENGAGEMENT:
1. MISSION SCOPE IS ABSOLUTE. Execute exactly what the briefing describes. Nothing more. Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice. If it is not in the briefing, it does not exist.
2. REPORT, DON''T FIX. If you encounter issues outside your scope, log them in your debrief under "Recommended Next Actions." The Commander decides follow-ups.
3. SPEED AND PRECISION. Minimal file reads — only what you need. Surgical edits — only the lines that matter.
4. COMMIT DISCIPLINE. Commit with clear, descriptive messages. Only commit files related to your mission.
5. DEBRIEF IS MANDATORY. On completion, provide a debrief to the Commander:
   - What was done (precise changes)
   - What changed (files modified)
   - Risks (anything that could break)
   - ## Recommended Next Actions (bullet list of follow-up tasks)',
  (strftime('%s','now') * 1000)
);
--> statement-breakpoint
UPDATE assets
SET system_prompt = substr(
  system_prompt,
  length(
    'You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.

RULES OF ENGAGEMENT:
1. MISSION SCOPE IS ABSOLUTE. Execute exactly what the briefing describes. Nothing more. Do not fix unrelated bugs. Do not refactor adjacent code. Do not "improve" things you notice. If it is not in the briefing, it does not exist.
2. REPORT, DON''T FIX. If you encounter issues outside your scope, log them in your debrief under "Recommended Next Actions." The Commander decides follow-ups.
3. SPEED AND PRECISION. Minimal file reads — only what you need. Surgical edits — only the lines that matter.
4. COMMIT DISCIPLINE. Commit with clear, descriptive messages. Only commit files related to your mission.
5. DEBRIEF IS MANDATORY. On completion, provide a debrief to the Commander:
   - What was done (precise changes)
   - What changed (files modified)
   - Risks (anything that could break)
   - ## Recommended Next Actions (bullet list of follow-up tasks)


'
  ) + 1
)
WHERE is_system = 0
  AND system_prompt LIKE 'You are a DEVROOM asset — an autonomous agent deployed on surgical missions by the Commander.' || char(10) || char(10) || 'RULES OF ENGAGEMENT:%';
```

**Note:** In SQL string literals, single quotes are escaped by doubling (`DON''T`). The `LIKE` pattern uses the first two lines of the ROE to detect the prefix — any asset whose prompt begins with these lines will have exactly `length(LEGACY_ROE_PREFIX)` characters stripped from the front. The `+ 1` is because `substr` is 1-indexed. Assets whose prompt has been manually customized to no longer start with this exact text are left alone.

- [ ] **Step 2: Run the migration against a fresh test DB**

```bash
rm -f /tmp/devroom-roe-test.db
DEVROOM_DB_PATH=/tmp/devroom-roe-test.db pnpm drizzle-kit push
```

Then apply a minimal integration check:

```bash
DEVROOM_DB_PATH=/tmp/devroom-roe-test.db pnpm seed
DEVROOM_DB_PATH=/tmp/devroom-roe-test.db node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/tmp/devroom-roe-test.db');
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('rules_of_engagement');
  console.log('ROE length:', row.value.length);
  const op = db.prepare(\"SELECT system_prompt FROM assets WHERE codename = 'OPERATIVE'\").get();
  console.log('OPERATIVE starts with:', JSON.stringify(op.system_prompt.slice(0, 60)));
"
```

Expected output:
- `ROE length:` is ~1100–1300 chars.
- `OPERATIVE starts with:` begins with `"You are a general-purpose engineer."` — **NOT** with `"You are a DEVROOM asset"`.

(Note: Task 6 will modify `scripts/seed.ts` to no longer prepend ROE. Until Task 6 lands, running `pnpm seed` will re-insert the old prefix. That's fine — the strip is verified against pre-Task-6 data here and again against clean data after Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/migrations/0020_shared_roe.sql
git commit -m "feat(db): seed rules_of_engagement and strip legacy prefix from mission assets"
```

---

## Task 4: Runtime ROE reader with test seam

**Files:**
- Create: `src/lib/settings/rules-of-engagement.ts`

- [ ] **Step 1: Create the reader**

```ts
// src/lib/settings/rules-of-engagement.ts
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { settings } from '@/lib/db/schema';

let override: string | null | undefined = undefined;

/**
 * Returns the current Rules of Engagement text from the `settings` table.
 * Returns an empty string if no row exists (fail-safe: no prefix applied).
 *
 * Tests can inject a value via `__setRulesOfEngagementOverride()`.
 */
export function getRulesOfEngagement(): string {
  if (override !== undefined) return override ?? '';
  const db = getDatabase();
  const row = db.select().from(settings).where(eq(settings.key, 'rules_of_engagement')).get() as
    | { value: string }
    | undefined;
  return row?.value ?? '';
}

export function updateRulesOfEngagement(value: string): void {
  const db = getDatabase();
  const now = Date.now();
  db.insert(settings)
    .values({ key: 'rules_of_engagement', value, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: now },
    })
    .run();
}

/** Test seam. Pass `null` to force empty string; pass `undefined` to clear override. */
export function __setRulesOfEngagementOverride(value: string | null | undefined): void {
  override = value;
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings/rules-of-engagement.ts
git commit -m "feat(settings): add runtime rules of engagement reader"
```

---

## Task 5: Compose ROE in `buildAssetCliArgs` (TDD)

**Files:**
- Modify: `src/lib/orchestrator/asset-cli.ts`
- Modify: `src/lib/orchestrator/__tests__/asset-cli.test.ts`

- [ ] **Step 1: Add failing tests**

Add these tests at the end of the `describe('buildAssetCliArgs', ...)` block in `src/lib/orchestrator/__tests__/asset-cli.test.ts`:

```ts
import { __setRulesOfEngagementOverride } from '@/lib/settings/rules-of-engagement';

describe('rules of engagement composition', () => {
  beforeEach(() => {
    __setRulesOfEngagementOverride('ROE-TEXT');
  });

  afterEach(() => {
    __setRulesOfEngagementOverride(undefined);
  });

  it('prepends ROE to mission asset system prompt', () => {
    const args = buildAssetCliArgs(
      makeAsset({ isSystem: 0, systemPrompt: 'You are OPERATIVE.' }),
    );
    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('ROE-TEXT\n\nYou are OPERATIVE.');
  });

  it('does NOT prepend ROE to system asset system prompt', () => {
    const args = buildAssetCliArgs(
      makeAsset({ isSystem: 1, systemPrompt: 'You are OVERSEER.' }),
    );
    const idx = args.indexOf('--append-system-prompt');
    expect(args[idx + 1]).toBe('You are OVERSEER.');
  });

  it('does not prepend when ROE is empty', () => {
    __setRulesOfEngagementOverride('');
    const args = buildAssetCliArgs(
      makeAsset({ isSystem: 0, systemPrompt: 'You are OPERATIVE.' }),
    );
    const idx = args.indexOf('--append-system-prompt');
    expect(args[idx + 1]).toBe('You are OPERATIVE.');
  });
});
```

Also add `afterEach` to the import line at the top: `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';`

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm vitest run src/lib/orchestrator/__tests__/asset-cli.test.ts`
Expected: FAIL — all 3 new tests fail (current implementation passes systemPrompt as-is).

- [ ] **Step 3: Implement the composition**

Modify `src/lib/orchestrator/asset-cli.ts`. Add this import near the top:

```ts
import { getRulesOfEngagement } from '@/lib/settings/rules-of-engagement';
```

Replace the `// --append-system-prompt` block (currently lines 65–68):

```ts
  // --append-system-prompt (prepend shared ROE for mission assets)
  if (asset.systemPrompt) {
    const roe = asset.isSystem === 0 ? getRulesOfEngagement() : '';
    const composed = roe ? `${roe}\n\n${asset.systemPrompt}` : asset.systemPrompt;
    args.push('--append-system-prompt', composed);
  }
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm vitest run src/lib/orchestrator/__tests__/asset-cli.test.ts`
Expected: PASS — all tests green, including pre-existing ones.

(Pre-existing tests don't set an override, so `getRulesOfEngagement()` falls through to the DB. In test mode the DB may not have the settings row, in which case the reader returns `''` and the existing behavior is preserved. If the pre-existing `returns --append-system-prompt when systemPrompt is set` test fails because an override is leaking, ensure `afterEach` clears it.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/orchestrator/asset-cli.ts src/lib/orchestrator/__tests__/asset-cli.test.ts
git commit -m "feat(orchestrator): compose shared ROE onto mission asset prompts"
```

---

## Task 6: Remove ROE from seed script

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Delete the constant and the concatenations**

In `scripts/seed.ts`:

1. Delete lines 11–25 (the `Shared rules of engagement` comment block and the `RULES_OF_ENGAGEMENT` constant).
2. For each of the 5 mission assets (OPERATIVE, VANGUARD, ARCHITECT, ASSERT, INTEL), change:
   ```ts
   systemPrompt:
     RULES_OF_ENGAGEMENT +
     '\n\nYou are a general-purpose engineer. ...',
   ```
   to:
   ```ts
   systemPrompt: 'You are a general-purpose engineer. ...',
   ```
   (Drop the `RULES_OF_ENGAGEMENT +` and the leading `\n\n`. Keep the asset-specific text verbatim.)

- [ ] **Step 2: Seed the settings row from the seed script**

At the top of `scripts/seed.ts`, add imports:

```ts
import { settings } from '../src/lib/db/schema';
import { DEFAULT_RULES_OF_ENGAGEMENT } from '../src/lib/settings/default-rules-of-engagement';
```

Find the `main()` / seeding function and add (near the other seed blocks, before or after assets — order does not matter):

```ts
// Seed the default Rules of Engagement if not already present
const existingRoe = db.select().from(settings).where(eq(settings.key, 'rules_of_engagement')).get();
if (!existingRoe) {
  db.insert(settings).values({
    key: 'rules_of_engagement',
    value: DEFAULT_RULES_OF_ENGAGEMENT,
    updatedAt: Date.now(),
  }).run();
  console.log('✓ Seeded default rules_of_engagement');
}
```

(`eq` is already imported at the top of the file.)

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Re-run the fresh-DB integration check from Task 3**

```bash
rm -f /tmp/devroom-roe-test.db
DEVROOM_DB_PATH=/tmp/devroom-roe-test.db pnpm drizzle-kit push
DEVROOM_DB_PATH=/tmp/devroom-roe-test.db pnpm seed
DEVROOM_DB_PATH=/tmp/devroom-roe-test.db node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/tmp/devroom-roe-test.db');
  const op = db.prepare(\"SELECT system_prompt FROM assets WHERE codename = 'OPERATIVE'\").get();
  console.log('OPERATIVE prompt:', JSON.stringify(op.system_prompt.slice(0, 80)));
  const roe = db.prepare(\"SELECT value FROM settings WHERE key = 'rules_of_engagement'\").get();
  console.log('ROE present:', !!roe, 'length:', roe?.value.length);
"
```

Expected:
- `OPERATIVE prompt:` begins with `"You are a general-purpose engineer."`.
- `ROE present: true` and length is ~1100–1300.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts
git commit -m "refactor(seed): remove baked-in ROE, seed settings row instead"
```

---

## Task 7: Server Actions for reading/updating ROE (TDD)

**Files:**
- Create: `src/actions/settings.ts`
- Create: `src/actions/__tests__/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/actions/__tests__/settings.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase } from '@/lib/db/index';
import { settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  getRulesOfEngagementAction,
  updateRulesOfEngagementAction,
} from '@/actions/settings';

describe('settings actions — rules of engagement', () => {
  beforeEach(() => {
    const db = getDatabase();
    db.delete(settings).where(eq(settings.key, 'rules_of_engagement')).run();
  });

  it('getRulesOfEngagementAction returns empty string when unset', async () => {
    const result = await getRulesOfEngagementAction();
    expect(result.value).toBe('');
    expect(result.updatedAt).toBeNull();
  });

  it('updateRulesOfEngagementAction writes a value', async () => {
    await updateRulesOfEngagementAction('new rules text');
    const result = await getRulesOfEngagementAction();
    expect(result.value).toBe('new rules text');
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  it('updateRulesOfEngagementAction overwrites an existing value', async () => {
    await updateRulesOfEngagementAction('first');
    await updateRulesOfEngagementAction('second');
    const result = await getRulesOfEngagementAction();
    expect(result.value).toBe('second');
  });

  it('updateRulesOfEngagementAction rejects empty strings', async () => {
    await expect(updateRulesOfEngagementAction('')).rejects.toThrow(/empty/i);
  });
});
```

- [ ] **Step 2: Run and verify the tests fail**

Run: `pnpm vitest run src/actions/__tests__/settings.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the Server Actions**

```ts
// src/actions/settings.ts
'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { settings } from '@/lib/db/schema';
import { updateRulesOfEngagement } from '@/lib/settings/rules-of-engagement';

const ROE_KEY = 'rules_of_engagement';

export async function getRulesOfEngagementAction(): Promise<{
  value: string;
  updatedAt: number | null;
}> {
  const db = getDatabase();
  const row = db.select().from(settings).where(eq(settings.key, ROE_KEY)).get() as
    | { value: string; updatedAt: number }
    | undefined;
  return {
    value: row?.value ?? '',
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function updateRulesOfEngagementAction(value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('Update rules of engagement: value must not be empty');
  }
  updateRulesOfEngagement(value);
  revalidatePath('/assets');
}
```

- [ ] **Step 4: Run and verify the tests pass**

Run: `pnpm vitest run src/actions/__tests__/settings.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/actions/settings.ts src/actions/__tests__/settings.test.ts
git commit -m "feat(actions): add rules of engagement server actions"
```

---

## Task 8: ROE editor Client Component

**Files:**
- Create: `src/components/settings/rules-of-engagement-editor.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/settings/rules-of-engagement-editor.tsx
'use client';

import { useState, useTransition } from 'react';
import { updateRulesOfEngagementAction } from '@/actions/settings';

interface Props {
  initialValue: string;
  initialUpdatedAt: number | null;
}

export function RulesOfEngagementEditor({ initialValue, initialUpdatedAt }: Props) {
  const [value, setValue] = useState(initialValue);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = value !== initialValue && value.trim().length > 0;

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateRulesOfEngagementAction(value);
        const now = Date.now();
        setUpdatedAt(now);
        setSavedAt(now);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    });
  };

  const timestampLabel = updatedAt
    ? `LAST UPDATED: ${new Date(updatedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`
    : 'NEVER UPDATED';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
          {timestampLabel}
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          APPLIES TO MISSION ASSETS ONLY
        </div>
      </div>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        className="min-h-[500px] w-full resize-y rounded border border-border bg-background p-4 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
        spellCheck={false}
      />
      {error && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400 font-mono">
          ERROR: {error}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground font-mono">
          {savedAt && !dirty ? '✓ SAVED' : dirty ? 'UNSAVED CHANGES' : ''}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || isPending}
          className="rounded border border-primary bg-primary/10 px-4 py-2 font-mono text-sm uppercase tracking-wider text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'SAVING...' : 'SAVE'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/rules-of-engagement-editor.tsx
git commit -m "feat(ui): add rules of engagement editor component"
```

---

## Task 9: Add tabs to `/assets` page

**Files:**
- Modify: `src/app/(hq)/assets/page.tsx`

- [ ] **Step 1: Check the existing Tabs primitive**

Run: `pnpm grep -r "tabs" src/components/ui 2>/dev/null || find src/components -name "tabs*"`

If a tabs primitive exists (e.g. `@/components/ui/tabs`), use it below. Otherwise fall back to `<a href>`-based sub-navigation using query params. The code below assumes a shadcn-style `Tabs` primitive at `@/components/ui/tabs`; if that import doesn't exist, adjust to the project's actual component.

- [ ] **Step 2: Rewrite the assets page with tabs**

Replace `src/app/(hq)/assets/page.tsx` with:

```tsx
import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { AssetList } from '@/components/asset/asset-list';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { RulesOfEngagementEditor } from '@/components/settings/rules-of-engagement-editor';
import { getRulesOfEngagementAction } from '@/actions/settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Asset } from '@/types';

export default async function AssetsPage() {
  const db = getDatabase();
  const allAssets = db.select().from(assets).all() as Asset[];
  const missionAssets = allAssets.filter(a => !a.isSystem);
  const systemAssets = allAssets.filter(a => a.isSystem);
  const roe = await getRulesOfEngagementAction();

  return (
    <PageWrapper
      breadcrumb={['NYHZ OPS', 'ASSETS']}
      title="AGENT ROSTER"
    >
      <Tabs defaultValue="roster" className="w-full">
        <TabsList>
          <TabsTrigger value="roster">ROSTER</TabsTrigger>
          <TabsTrigger value="roe">RULES OF ENGAGEMENT</TabsTrigger>
        </TabsList>
        <TabsContent value="roster" className="mt-6">
          <div className="space-y-8">
            <AssetList title="MISSION ASSETS" assets={missionAssets} showSystemBadge={false} />
            <AssetList title="SYSTEM ASSETS" assets={systemAssets} showSystemBadge={true} />
          </div>
        </TabsContent>
        <TabsContent value="roe" className="mt-6">
          <RulesOfEngagementEditor
            initialValue={roe.value}
            initialUpdatedAt={roe.updatedAt}
          />
        </TabsContent>
      </Tabs>
    </PageWrapper>
  );
}
```

If `@/components/ui/tabs` does not exist in the codebase, check for existing tab usage via `grep -r "TabsTrigger" src` and use whichever primitive is already in use. If no tab primitive exists at all, use a simple two-button switcher — but verify first.

- [ ] **Step 3: Run build and visit the page**

Run: `pnpm build`
Expected: PASS.

Then manually: start `pnpm dev`, open `/assets`, click the RULES OF ENGAGEMENT tab. Confirm the textarea renders with the seeded text. Make a trivial edit (add a space at the end), click SAVE, reload the page, confirm the change persisted.

- [ ] **Step 4: Commit**

```bash
git add src/app/(hq)/assets/page.tsx
git commit -m "feat(ui): add rules of engagement tab to assets page"
```

---

## Task 10: Update documentation

**Files:**
- Modify: `.devroom/spec-prompts.md`
- Modify: `.devroom/spec-missions.md`

- [ ] **Step 1: Update `.devroom/spec-prompts.md`**

Replace the `## Rules of Engagement` section (lines 17–25, approximately) with:

```markdown
## Rules of Engagement

Stored as a single row in the `settings` table under key `rules_of_engagement`. Composed onto mission asset system prompts at runtime by `buildAssetCliArgs()` in `src/lib/orchestrator/asset-cli.ts` — **only when `isSystem === 0`**. System assets (`GENERAL`/`STRATEGIST`, `OVERSEER`, `QUARTERMASTER`) receive their own standalone prompts with no shared prefix.

Edited via the RULES OF ENGAGEMENT tab on `/assets`. Default text lives in `src/lib/settings/default-rules-of-engagement.ts` and is seeded by both the 0020 migration and `scripts/seed.ts`.
```

Also update the parenthetical on the former line 63 (`Note: The asset system prompt (including Rules of Engagement)...`) to read:

```markdown
Note: The asset system prompt (with shared Rules of Engagement prepended at runtime for mission assets) is passed as a CLI flag (`--append-system-prompt`), not embedded in the prompt text.
```

- [ ] **Step 2: Update `.devroom/spec-missions.md`**

In the `### Asset Fields` table, change the `systemPrompt` row description from:

```
| `systemPrompt`   | string       | Full system prompt including Rules of Engagement (for mission assets). |
```

to:

```
| `systemPrompt`   | string       | Asset-specific system prompt. For mission assets the shared Rules of Engagement (from `settings.rules_of_engagement`) is prepended at runtime by `buildAssetCliArgs()`. |
```

- [ ] **Step 3: Commit**

```bash
git add .devroom/spec-prompts.md .devroom/spec-missions.md
git commit -m "docs: update specs for runtime-composed rules of engagement"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: PASS — all tests green.

- [ ] **Step 2: Run full build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: End-to-end smoke test on a fresh DB**

```bash
rm -f /tmp/devroom-roe-final.db
DEVROOM_DB_PATH=/tmp/devroom-roe-final.db pnpm drizzle-kit push
DEVROOM_DB_PATH=/tmp/devroom-roe-final.db pnpm seed
DEVROOM_DB_PATH=/tmp/devroom-roe-final.db node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/tmp/devroom-roe-final.db');
  const roe = db.prepare(\"SELECT value FROM settings WHERE key = 'rules_of_engagement'\").get();
  const mission = db.prepare(\"SELECT codename, system_prompt FROM assets WHERE is_system = 0\").all();
  const system = db.prepare(\"SELECT codename, system_prompt FROM assets WHERE is_system = 1\").all();
  console.log('ROE present:', !!roe);
  console.log();
  for (const a of mission) {
    const startsWithROE = a.system_prompt.startsWith('You are a DEVROOM asset');
    console.log(a.codename, 'starts with ROE?', startsWithROE, '← should be false');
  }
  console.log();
  for (const a of system) {
    console.log(a.codename, '(system) — prompt length:', a.system_prompt.length);
  }
"
```

Expected:
- `ROE present: true`
- Every mission asset reports `starts with ROE? false`
- System assets (`GENERAL`, `STRATEGIST`, `OVERSEER`, `QUARTERMASTER`) are present with non-zero prompt length.

- [ ] **Step 4: Apply the migration to the real dev DB**

```bash
pnpm drizzle-kit push
```

Expected: migration `0020_shared_roe` applies cleanly. If the existing mission assets in the dev DB have the legacy prefix, it is stripped. If any asset row has been manually edited away from the prefix, the `LIKE` guard leaves it untouched — check manually in the RULES OF ENGAGEMENT tab and on the asset detail page.

- [ ] **Step 5: Done — no commit needed, everything already committed per-task.**

---

## Self-Review Notes

- **Spec coverage:**
  - Settings table ✓ Task 2, 3
  - Migration with strip ✓ Task 3
  - Runtime composition, mission assets only ✓ Task 5
  - Seed script cleanup ✓ Task 6
  - Server Actions ✓ Task 7
  - Editor component ✓ Task 8
  - Tab on `/assets` ✓ Task 9
  - Default text single source of truth ✓ Task 1
  - Test seam for DB-dependent function ✓ Task 4, Task 5
  - Docs update ✓ Task 10
  - Testing ✓ Tasks 5, 7, 11
- **Placeholders:** none — all code and SQL is written out.
- **Type consistency:** `updateRulesOfEngagement` (lib) vs `updateRulesOfEngagementAction` (action) are distinct by design; action wraps lib + `revalidatePath`. `getRulesOfEngagement()` returns `string`; `getRulesOfEngagementAction()` returns `{ value, updatedAt }`. Names consistent across Tasks 4, 5, 7, 8, 9.
- **Known risk:** Task 9 assumes a shadcn-style tabs primitive. If none exists, the step calls out the fallback — verify before writing code.
