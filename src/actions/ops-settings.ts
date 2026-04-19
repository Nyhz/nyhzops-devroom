'use server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { managedApps } from '@/lib/db/schema';
import { discoverManagedApps, seedDevroomRow } from '@/lib/ops/discovery';
import { homedir } from 'os';
import path from 'path';

export async function updateManagedApp(slug: string, patch: {
  healthUrl?: string | null;
  ctlScriptPath?: string;
  logPath?: string;
  displayName?: string;
  orderIdx?: number;
}): Promise<void> {
  const db = getDatabase();
  db.update(managedApps).set({ ...patch, updatedAt: Date.now() }).where(eq(managedApps.slug, slug)).run();
  revalidatePath('/ops');
}

export async function updateManagedAppForm(slug: string, fd: FormData): Promise<void> {
  const healthUrlRaw = String(fd.get('healthUrl') ?? '');
  await updateManagedApp(slug, {
    displayName: String(fd.get('displayName') ?? ''),
    ctlScriptPath: String(fd.get('ctlScriptPath') ?? ''),
    logPath: String(fd.get('logPath') ?? ''),
    healthUrl: healthUrlRaw || null,
    orderIdx: Number(fd.get('orderIdx') ?? 0),
  });
}

export async function rescan(): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  const devroomRoot = process.cwd();
  const battlefieldsRoot = path.resolve(devroomRoot, '..', 'battlefields');
  const rows = [
    seedDevroomRow({ homeRoot: homedir(), devroomRoot, port: 7777, now: () => now }),
    ...discoverManagedApps({ battlefieldsRoot, homeRoot: homedir(), now: () => now }),
  ];
  for (const r of rows) {
    db.insert(managedApps).values(r).onConflictDoUpdate({
      target: managedApps.slug,
      set: {
        ctlScriptPath: r.ctlScriptPath,
        logPath: r.logPath,
        healthUrl: r.healthUrl,
        updatedAt: now,
      },
    }).run();
  }
  revalidatePath('/ops');
}
