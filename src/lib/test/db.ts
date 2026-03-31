import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/lib/db/schema';
import { getTableColumns, sql } from 'drizzle-orm';
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';

type TestDB = ReturnType<typeof drizzle<typeof schema>>;

const tables = [
  schema.battlefields,
  schema.missions,
  schema.campaigns,
  schema.phases,
  schema.briefingSessions,
  schema.briefingMessages,
  schema.assets,
  schema.missionLogs,
  schema.scheduledTasks,
  schema.dossiers,
  schema.captainLogs,
  schema.notifications,
  schema.commandLogs,
  schema.generalSessions,
  schema.generalMessages,
  schema.followUpSuggestions,
  schema.intelNotes,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTableSQL(table: SQLiteTableWithColumns<any>): string {
  const tableName = table[Symbol.for('drizzle:Name') as unknown as keyof typeof table] as string;
  const columns = getTableColumns(table);
  const colDefs: string[] = [];

  for (const [, col] of Object.entries(columns)) {
    const c = col as { name: string; columnType: string; primary: boolean; notNull: boolean; hasDefault: boolean; default?: unknown };
    let colType = 'text';
    if (c.columnType === 'SQLiteInteger') colType = 'integer';

    let def = `"${c.name}" ${colType}`;
    if (c.primary) def += ' primary key';
    if (c.notNull && !c.primary) def += ' not null';
    if (c.hasDefault && c.default !== undefined) {
      const val = typeof c.default === 'string' ? `'${c.default}'` : c.default;
      def += ` default ${val}`;
    }
    colDefs.push(def);
  }

  return `CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs.join(', ')})`;
}

export function getTestDb(): { db: TestDB; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF'); // Simpler for test isolation
  const db = drizzle(sqlite, { schema });

  for (const table of tables) {
    const ddl = createTableSQL(table);
    sqlite.exec(ddl);
  }

  return { db, sqlite };
}

export function closeTestDb(sqlite: Database.Database): void {
  sqlite.close();
}

export type { TestDB };
