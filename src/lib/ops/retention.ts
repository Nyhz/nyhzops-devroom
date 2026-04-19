import type Database from 'better-sqlite3';

export function runRetention(db: Database.Database, now: number): void {
  const oneHourAgo = now - 3600 * 1000;
  const oneDayAgo = now - 24 * 3600 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;

  const txn = db.transaction(() => {
    db.prepare(`
      INSERT INTO managed_app_metrics (slug, ts, bucket, rss, cpu, healthy, http_code, latency_ms)
      SELECT slug, (ts / 60000) * 60000 AS bts, '1m',
             CAST(AVG(rss) AS INTEGER), AVG(cpu), MAX(healthy),
             CAST(AVG(http_code) AS INTEGER), CAST(AVG(latency_ms) AS INTEGER)
      FROM managed_app_metrics WHERE bucket='raw' AND ts < ?
      GROUP BY slug, bts;
    `).run(oneHourAgo);
    db.prepare(`DELETE FROM managed_app_metrics WHERE bucket='raw' AND ts < ?`).run(oneHourAgo);

    db.prepare(`
      INSERT INTO managed_app_metrics (slug, ts, bucket, rss, cpu, healthy, http_code, latency_ms)
      SELECT slug, (ts / 300000) * 300000 AS bts, '5m',
             CAST(AVG(rss) AS INTEGER), AVG(cpu), MAX(healthy),
             CAST(AVG(http_code) AS INTEGER), CAST(AVG(latency_ms) AS INTEGER)
      FROM managed_app_metrics WHERE bucket='1m' AND ts < ?
      GROUP BY slug, bts;
    `).run(oneDayAgo);
    db.prepare(`DELETE FROM managed_app_metrics WHERE bucket='1m' AND ts < ?`).run(oneDayAgo);

    db.prepare(`DELETE FROM managed_app_metrics WHERE bucket='5m' AND ts < ?`).run(sevenDaysAgo);
  });

  txn();
}

export function vacuumMetrics(db: Database.Database): void {
  db.exec('VACUUM');
}
