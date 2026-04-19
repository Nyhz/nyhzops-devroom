import { OpsGrid } from '@/components/ops/OpsGrid';
import { getDatabase } from '@/lib/db';
import { managedApps } from '@/lib/db/schema';
import type { OpsStatus } from '@/lib/ops/types';

export const dynamic = 'force-dynamic';

type AppRow = typeof managedApps.$inferSelect;

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

  return (
    <div className="p-6">
      <h1 className="text-amber-500 tracking-widest text-lg mb-6 font-mono">OPS</h1>
      <OpsGrid initial={snap} />
    </div>
  );
}
