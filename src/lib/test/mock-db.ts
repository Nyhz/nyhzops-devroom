import { eq } from 'drizzle-orm';
import type { TestDB } from './db';

/**
 * Create a mock `@/lib/db/index` module that uses the provided test database getter.
 *
 * Usage in test files:
 * ```ts
 * let db: TestDB;
 * vi.mock('@/lib/db/index', () => createMockDbModule(() => db));
 * ```
 *
 * The getter function is used (instead of a direct reference) so the mock
 * captures the current value of `db` at call time — even when `db` is
 * reassigned in `beforeEach`.
 */
export function createMockDbModule(getDb: () => TestDB) {
  return {
    getDatabase: () => getDb(),
    getOrThrow: (table: { id: unknown }, id: string, label: string) => {
      const row = getDb().select().from(table).where(eq(table.id, id)).get();
      if (!row) throw new Error(`${label}: ${id} not found`);
      return row;
    },
  };
}
