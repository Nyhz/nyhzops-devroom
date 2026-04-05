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
