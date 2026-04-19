import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ManagedApp } from './types';

export interface DiscoveryIO {
  battlefieldsRoot: string;
  homeRoot: string;
  now: () => number;
}

export interface DevroomSeedIO {
  homeRoot: string;
  devroomRoot: string;
  port: number;
  now: () => number;
}

function extractPort(scriptPath: string): number | null {
  try {
    const contents = readFileSync(scriptPath, 'utf-8');
    const m = contents.match(/^\s*PORT\s*=\s*["']?(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export function discoverManagedApps(io: DiscoveryIO): ManagedApp[] {
  if (!existsSync(io.battlefieldsRoot)) return [];
  const entries = readdirSync(io.battlefieldsRoot);
  const rows: ManagedApp[] = [];
  for (const slug of entries) {
    const dir = join(io.battlefieldsRoot, slug);
    if (!statSync(dir).isDirectory()) continue;
    const ctl = join(dir, 'scripts', `${slug}-ctl.sh`);
    if (!existsSync(ctl)) continue;
    const port = extractPort(ctl);
    rows.push({
      slug,
      displayName: slug.toUpperCase(),
      battlefieldId: null,
      launchdLabel: `com.${slug}.app`,
      ctlScriptPath: ctl,
      logPath: join(io.homeRoot, `.${slug}`, 'logs', `${slug}.log`),
      healthUrl: port ? `http://localhost:${port}/` : null,
      orderIdx: 0,
      isSelfControlled: false,
      createdAt: io.now(),
      updatedAt: io.now(),
    });
  }
  return rows;
}

export function seedDevroomRow(io: DevroomSeedIO): ManagedApp {
  return {
    slug: 'devroom',
    displayName: 'DEVROOM',
    battlefieldId: null,
    launchdLabel: 'com.devroom.app',
    ctlScriptPath: join(io.devroomRoot, 'scripts', 'devroom-ctl.sh'),
    logPath: join(io.homeRoot, '.devroom', 'logs', 'devroom.log'),
    healthUrl: `http://localhost:${io.port}/api/health`,
    orderIdx: -1,
    isSelfControlled: true,
    createdAt: io.now(),
    updatedAt: io.now(),
  };
}
