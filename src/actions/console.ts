'use server';

import fs from 'fs';
import path from 'path';
import { eq, desc } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields, commandLogs } from '@/lib/db/schema';
import { runCommand } from '@/lib/process/command-runner';
import type { DevServerStatus } from '@/lib/process/dev-server';
import type { CommandLog } from '@/types';

// ---------------------------------------------------------------------------
// Dev Server Actions
// ---------------------------------------------------------------------------

export async function startDevServer(battlefieldId: string): Promise<void> {
  const db = getDatabase();
  const bf = db.select().from(battlefields).where(eq(battlefields.id, battlefieldId)).get();
  if (!bf) throw new Error(`startDevServer: battlefield ${battlefieldId} not found`);
  if (!bf.devServerCommand) throw new Error(`startDevServer: no dev server command configured for ${bf.codename}`);

  const manager = globalThis.devServerManager;
  if (!manager) throw new Error('startDevServer: DevServerManager not initialized');

  manager.start(battlefieldId, bf.devServerCommand, bf.repoPath);
}

export async function stopDevServer(battlefieldId: string): Promise<void> {
  const manager = globalThis.devServerManager;
  if (!manager) throw new Error('stopDevServer: DevServerManager not initialized');

  manager.stop(battlefieldId);
}

export async function restartDevServer(battlefieldId: string): Promise<void> {
  const db = getDatabase();
  const bf = db.select().from(battlefields).where(eq(battlefields.id, battlefieldId)).get();
  if (!bf) throw new Error(`restartDevServer: battlefield ${battlefieldId} not found`);
  if (!bf.devServerCommand) throw new Error(`restartDevServer: no dev server command configured for ${bf.codename}`);

  const manager = globalThis.devServerManager;
  if (!manager) throw new Error('restartDevServer: DevServerManager not initialized');

  manager.restart(battlefieldId, bf.devServerCommand, bf.repoPath);
}

export async function getDevServerStatus(battlefieldId: string): Promise<DevServerStatus> {
  const manager = globalThis.devServerManager;
  if (!manager) return { running: false, port: null, pid: null, uptime: null };

  return manager.getStatus(battlefieldId);
}

// ---------------------------------------------------------------------------
// Quick Command Actions
// ---------------------------------------------------------------------------

export async function runQuickCommand(battlefieldId: string, command: string): Promise<void> {
  const db = getDatabase();
  const bf = db.select().from(battlefields).where(eq(battlefields.id, battlefieldId)).get();
  if (!bf) throw new Error(`runQuickCommand: battlefield ${battlefieldId} not found`);

  // Fire and forget — output streams via Socket.IO to console:{battlefieldId}
  runCommand({
    command,
    cwd: bf.repoPath,
    socketRoom: `console:${battlefieldId}`,
    battlefieldId,
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DEVROOM] Quick command failed for ${bf.codename}: ${message}`);
  });
}

export async function getPackageScripts(battlefieldId: string): Promise<Record<string, string>> {
  const db = getDatabase();
  const bf = db.select().from(battlefields).where(eq(battlefields.id, battlefieldId)).get();
  if (!bf) throw new Error(`getPackageScripts: battlefield ${battlefieldId} not found`);

  const pkgPath = path.join(bf.repoPath, 'package.json');
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return pkg.scripts || {};
  } catch {
    return {};
  }
}

export async function getCommandHistory(
  battlefieldId: string,
  limit = 20,
): Promise<CommandLog[]> {
  const db = getDatabase();
  return db
    .select()
    .from(commandLogs)
    .where(eq(commandLogs.battlefieldId, battlefieldId))
    .orderBy(desc(commandLogs.createdAt))
    .limit(limit)
    .all();
}
