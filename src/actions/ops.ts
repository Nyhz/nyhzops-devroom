'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { managedApps } from '@/lib/db/schema';
import { defaultCtlRunner } from '@/lib/ops/ctl';
import { _makeOpsActions, type OpsDeps } from '@/lib/ops/actions-factory';
import type { ManagedApp } from '@/lib/ops/types';

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
export const startApp = prod.startApp;
export const stopApp = prod.stopApp;
export const restartApp = prod.restartApp;
export const setMode = prod.setMode;
