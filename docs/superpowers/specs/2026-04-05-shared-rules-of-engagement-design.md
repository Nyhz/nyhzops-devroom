# Shared Rules of Engagement — Design

**Date:** 2026-04-05
**Status:** Draft

## Problem

Every mission asset (`OPERATIVE`, `VANGUARD`, `ARCHITECT`, `ASSERT`, `INTEL`) currently carries a baked-in copy of the `RULES_OF_ENGAGEMENT` constant from `scripts/seed.ts` — it is physically concatenated into each row's `systemPrompt` column at seed time. Editing the shared rules requires a code change and a re-seed, and the re-seed risks clobbering any per-asset customizations.

The Commander needs a single, editable "shared prompt" that is applied to all mission assets at runtime, without touching system assets (`OVERSEER`, `QUARTERMASTER`, `STRATEGIST`), which must remain strictly controlled.

## Goals

- One place to edit the shared ruleset; changes apply to every subsequent mission.
- Mission assets only — system assets are untouched.
- No duplication between a stored asset prompt and the shared ruleset.
- DEVROOM-native editing surface (DB-backed, UI editor, Server Action).
- Zero behavioral change on day one: default content matches the current `RULES_OF_ENGAGEMENT`.

## Non-Goals

- Per-asset overrides of the shared ruleset.
- Versioning or history of ruleset edits.
- Extending the shared ruleset to system assets.

## Design

### Data Model

New table `settings` (single-row key/value, simple):

```ts
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
```

The single row used for this feature is `key = 'rules_of_engagement'`. Using a key/value shape leaves room for future global settings without new migrations.

### Migration (`0020_shared_roe.sql`)

1. Create the `settings` table.
2. Insert the default row: `('rules_of_engagement', <current RULES_OF_ENGAGEMENT text>, now)`.
3. For each mission asset (`isSystem = 0`), strip the ROE prefix from `systemPrompt` if it matches exactly. If not, leave the row alone and log a warning during migration so the Commander can clean it manually.

Strip logic: the migration embeds a constant `LEGACY_ROE_PREFIX` (the exact text prepended by the old seed script, including the trailing blank line). For each of the 5 mission asset rows, if `systemPrompt` starts with `LEGACY_ROE_PREFIX`, remove that prefix.

### Runtime Composition

`src/lib/orchestrator/asset-cli.ts::buildAssetCliArgs()` currently passes `asset.systemPrompt` directly as `--append-system-prompt`. Change:

```ts
if (asset.systemPrompt) {
  const prefix = asset.isSystem === 0 ? getSharedRulesOfEngagement() : '';
  const composed = prefix ? `${prefix}\n\n${asset.systemPrompt}` : asset.systemPrompt;
  args.push('--append-system-prompt', composed);
}
```

A helper `getSharedRulesOfEngagement()` lives in `src/lib/settings/rules-of-engagement.ts` and reads from the `settings` table synchronously (better-sqlite3). It caches in-process for the lifetime of the spawn to avoid repeated reads within a single mission build.

**Important:** `buildAssetCliArgs()` becomes dependent on DB state. Existing tests that pass a fabricated `Asset` must either stub the settings reader or be updated to seed a settings row. The helper exposes a test seam (e.g. accepts an optional `rulesProvider` parameter, or the module exports a settable override).

### Seed Script

`scripts/seed.ts`:
- Delete the `RULES_OF_ENGAGEMENT` constant.
- Delete the concatenation when seeding the 5 mission assets — they seed with asset-specific prompts only.
- Seed the `settings` row with the ROE default text (moved from the deleted constant into a dedicated file, e.g. `src/lib/settings/default-rules-of-engagement.ts`, so both the seed script and the migration can reference the same source of truth).

### UI

New tab on `/assets` (not on a specific asset's detail page).

- `/assets` currently renders an asset grid. Wrap it in a tab container with two tabs:
  - **ROSTER** — the existing asset grid.
  - **RULES OF ENGAGEMENT** — a full-height textarea editor with a SAVE button and a "last updated" timestamp.
- The ROE tab is a Client Component wrapped by a Server Component parent that loads the current value from the `settings` table.
- SAVE calls a new Server Action `updateRulesOfEngagement(value: string)` in `src/actions/settings.ts` which writes the row, updates `updatedAt`, and `revalidatePath('/assets')`.
- The editor does not require confirmation for saves — changes only affect future missions, so the blast radius is low.

### Server Action

`src/actions/settings.ts`:

```ts
export async function updateRulesOfEngagement(value: string): Promise<void>
export async function getRulesOfEngagement(): Promise<{ value: string; updatedAt: Date }>
```

### Testing

- `src/lib/orchestrator/__tests__/asset-cli.test.ts` — add cases:
  - Mission asset (`isSystem: 0`) gets ROE prepended.
  - System asset (`isSystem: 1`) does NOT get ROE prepended.
  - Empty ROE string results in no prefix.
- `src/actions/__tests__/settings.test.ts` — new file, covers `updateRulesOfEngagement` and `getRulesOfEngagement`.
- Migration is tested via the existing migration harness (if any); otherwise a one-off test that runs the strip logic against fixture rows.

## Files Touched

**New**
- `src/lib/db/migrations/0020_shared_roe.sql`
- `src/lib/db/migrations/meta/0020_snapshot.json`
- `src/lib/settings/rules-of-engagement.ts` (runtime reader + cache)
- `src/lib/settings/default-rules-of-engagement.ts` (the default text)
- `src/actions/settings.ts`
- `src/actions/__tests__/settings.test.ts`
- `src/app/assets/_components/rules-of-engagement-tab.tsx`
- `src/app/assets/_components/assets-tabs.tsx` (tab shell)

**Modified**
- `src/lib/db/schema.ts` — add `settings` table.
- `src/lib/orchestrator/asset-cli.ts` — compose ROE for mission assets.
- `src/lib/orchestrator/__tests__/asset-cli.test.ts` — new test cases.
- `scripts/seed.ts` — remove baked-in ROE, seed settings row instead.
- `src/app/assets/page.tsx` — wrap existing content in tabs.
- `.devroom/spec-missions.md` — update Assets section to reference shared ROE.
- `.devroom/spec-prompts.md` — update Rules of Engagement section: now stored in `settings`, composed at runtime, mission assets only.

## Rollout

1. Land the migration, schema, settings module, and composition logic together. Day one: behavior is unchanged because the settings row contains the current ROE text.
2. Commander verifies the `/assets` → RULES OF ENGAGEMENT tab renders the expected text.
3. Commander can now edit freely; next mission picks up the change.

## Open Questions

None — all resolved during brainstorming.
