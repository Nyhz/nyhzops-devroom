import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import { config } from '../config';
import * as schema from './schema';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDatabase() {
  if (!_db) {
    sqlite = new Database(config.dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

export function runMigrations() {
  const db = getDatabase();
  migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
}

export function closeDatabase() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    _db = null;
  }
}

export type DB = ReturnType<typeof getDatabase>;

/**
 * Fetch a row by ID or throw a descriptive error.
 * Eliminates the repeated select→get→if(!row) throw pattern across all actions.
 * All tables in this project use `text('id').primaryKey()`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOrThrow<T extends SQLiteTableWithColumns<any>>(
  table: T,
  id: string,
  label: string,
): T['$inferSelect'] {
  const db = getDatabase();
  // All project tables have `id: text('id').primaryKey()`
  const row = db.select().from(table).where(eq(table.id, id)).get();
  if (!row) {
    throw new Error(`${label}: ${id} not found`);
  }
  return row;
}
