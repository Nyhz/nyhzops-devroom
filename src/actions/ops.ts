'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { managedApps } from '@/lib/db/schema';
import { defaultCtlRunner } from '@/lib/ops/ctl';
import { _makeOpsActions, type OpsDeps } from '@/lib/ops/actions-factory';
import type { ActionResult, ManagedApp } from '@/lib/ops/types';

const prodDeps: OpsDeps = {
  getApp: (slug) => {
    const db = getDatabase();
    const row = db.select().from(managedApps).where(eq(managedApps.slug, slug)).get();
    return (row as ManagedApp | undefined) ?? null;
  },
  runner: defaultCtlRunner,
  revalidate: revalidatePath,
};

const prod = _makeOpsActions(prodDeps);

export async function startApp(slug: string): Promise<ActionResult> {
  return prod.startApp(slug);
}
export async function stopApp(slug: string): Promise<ActionResult> {
  return prod.stopApp(slug);
}
export async function restartApp(slug: string): Promise<ActionResult> {
  return prod.restartApp(slug);
}
export async function setMode(slug: string, mode: 'prod' | 'dev'): Promise<ActionResult> {
  return prod.setMode(slug, mode);
}
