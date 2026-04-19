import { OpsGrid } from '@/components/ops/OpsGrid';
import { getDatabase } from '@/lib/db';
import { managedApps, managedAppMetrics } from '@/lib/db/schema';
import { gte } from 'drizzle-orm';
import type { OpsStatus } from '@/lib/ops/types';
import type { MetricPoint } from '@/components/ops/OpsDetail';

export const dynamic = 'force-dynamic';

type AppRow = typeof managedApps.$inferSelect;
type MetricRow = typeof managedAppMetrics.$inferSelect;

export default function OpsPage() {
  const db = getDatabase();
  const apps = db
    .select()
    .from(managedApps)
    .orderBy(managedApps.orderIdx, managedApps.slug)
    .all() as AppRow[];

  const poller = globalThis.opsPoller;
  const live = poller?.snapshot() ?? [];

  const snap: OpsStatus[] = apps.map((a) => {
    const found = live.find((s) => s.slug === a.slug);
    if (found) return found;
    return {
      slug: a.slug,
      displayName: a.displayName,
      mode: 'unknown',
      pid: null,
      lastExitCode: null,
      uptimeMs: null,
      rssBytes: null,
      cpuPercent: null,
      healthy: null,
      httpCode: null,
      latencyMs: null,
      state: 'stopped',
      isSelfControlled: a.isSelfControlled,
      lastUpdatedAt: Date.now(),
      sinceMs: null,
    };
  });

  const oneHourAgo = Date.now() - 3600 * 1000;
  const rows = db
    .select()
    .from(managedAppMetrics)
    .where(gte(managedAppMetrics.ts, oneHourAgo))
    .orderBy(managedAppMetrics.ts)
    .all() as MetricRow[];

  const metricsBySlug: Record<string, MetricPoint[]> = {};
  for (const r of rows) {
    (metricsBySlug[r.slug] ??= []).push({
      ts: r.ts,
      rss: r.rss,
      cpu: r.cpu,
      latency: r.latencyMs,
    });
  }

  return (
    <div className="p-6">
      <h1 className="text-amber-500 tracking-widest text-lg mb-6 font-mono">OPS</h1>
      <OpsGrid initial={snap} metricsBySlug={metricsBySlug} />
    </div>
  );
}
