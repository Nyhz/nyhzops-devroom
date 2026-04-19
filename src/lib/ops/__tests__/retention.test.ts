import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runRetention } from '../retention';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE managed_app_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL, ts INTEGER NOT NULL, bucket TEXT NOT NULL,
      rss INTEGER, cpu REAL, healthy INTEGER, http_code INTEGER, latency_ms INTEGER
    );
  `);
});

describe('runRetention', () => {
  it('rolls up raw -> 1m buckets older than 1h and deletes the source rows', () => {
    const now = 10 * 3600 * 1000;
    const twoHoursAgo = now - 2 * 3600 * 1000;
    const insert = db.prepare(`INSERT INTO managed_app_metrics (slug, ts, bucket, rss, cpu, healthy, http_code, latency_ms) VALUES (?,?,?,?,?,?,?,?)`);
    for (let i = 0; i < 20; i++) {
      insert.run('finances', twoHoursAgo + i * 3000, 'raw', 100_000 + i, 1.0, 1, 200, 10);
    }
    runRetention(db, now);
    const raw = db.prepare(`SELECT COUNT(*) AS n FROM managed_app_metrics WHERE bucket='raw'`).get() as { n: number };
    const oneM = db.prepare(`SELECT COUNT(*) AS n FROM managed_app_metrics WHERE bucket='1m'`).get() as { n: number };
    expect(raw.n).toBe(0);
    expect(oneM.n).toBe(1);
  });

  it('deletes 5m rows older than 7 days', () => {
    const now = 30 * 24 * 3600 * 1000;
    const eightDaysAgo = now - 8 * 24 * 3600 * 1000;
    db.prepare(`INSERT INTO managed_app_metrics (slug, ts, bucket) VALUES ('f', ?, '5m')`).run(eightDaysAgo);
    runRetention(db, now);
    const c = db.prepare(`SELECT COUNT(*) AS n FROM managed_app_metrics`).get() as { n: number };
    expect(c.n).toBe(0);
  });
});
