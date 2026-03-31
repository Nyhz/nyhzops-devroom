import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import { fileURLToPath } from 'url';
import * as schema from '@/lib/db/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // Run actual migrations against the in-memory DB
  migrate(db, {
    migrationsFolder: path.join(__dirname, '../db/migrations'),
  });

  return { db, sqlite };
}

export function closeTestDb(sqlite: Database.Database) {
  sqlite.close();
}
