import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/lib/db/schema';
import { getTableColumns, sql } from 'drizzle-orm';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';

export type TestDB = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Create a fresh in-memory SQLite database with all schema tables.
 * Each call returns a fully isolated database instance.
 */
export function getTestDb(): { db: TestDB; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF'); // Simpler for test isolation

  const db = drizzle(sqlite, { schema });

  // Create all tables from schema metadata
  const tables = [
    schema.battlefields,
    schema.campaigns,
    schema.phases,
    schema.assets,
    schema.missions,
    schema.missionLogs,
    schema.overseerLogs,
    schema.intelNotes,
    schema.followUpSuggestions,
    schema.notifications,
    schema.dossiers,
    schema.scheduledTasks,
    schema.commandLogs,
    schema.briefingSessions,
    schema.briefingMessages,
    schema.generalSessions,
    schema.generalMessages,
  ];

  for (const table of tables) {
    createTable(sqlite, table);
  }

  return { db, sqlite };
}

export function closeTestDb(sqlite: Database.Database): void {
  sqlite.close();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTable(sqlite: Database.Database, table: SQLiteTableWithColumns<any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableName = (table as any)[Symbol.for('drizzle:Name')] as string;
  const columns = getTableColumns(table);

  const colDefs: string[] = [];

  for (const [, col] of Object.entries(columns)) {
    const colMeta = col as unknown as {
      name: string;
      primary: boolean;
      notNull: boolean;
      hasDefault: boolean;
      default: unknown;
      columnType: string;
    };

    let colType = 'text';
    if (colMeta.columnType === 'SQLiteInteger') colType = 'integer';

    let def = `"${colMeta.name}" ${colType}`;
    if (colMeta.primary) def += ' PRIMARY KEY';
    if (colMeta.notNull && !colMeta.primary) def += ' NOT NULL';
    if (colMeta.hasDefault && colMeta.default !== undefined) {
      const defaultVal = colMeta.default;
      if (typeof defaultVal === 'object' && defaultVal !== null && 'queryChunks' in (defaultVal as object)) {
        // SQL expression default — skip for test tables
      } else if (typeof defaultVal === 'string') {
        def += ` DEFAULT '${defaultVal}'`;
      } else if (typeof defaultVal === 'number') {
        def += ` DEFAULT ${defaultVal}`;
      }
    }

    colDefs.push(def);
  }

  const createSql = `CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs.join(', ')})`;
  sqlite.exec(createSql);
}
