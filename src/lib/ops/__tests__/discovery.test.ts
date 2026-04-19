import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverManagedApps, seedDevroomRow, type DiscoveryIO } from '../discovery';

let tmp: string;
let io: DiscoveryIO;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ops-discover-'));
  const bf = join(tmp, 'battlefields');
  mkdirSync(join(bf, 'finances', 'scripts'), { recursive: true });
  writeFileSync(join(bf, 'finances', 'scripts', 'finances-ctl.sh'), '#!/bin/bash\nPORT=3200\n');
  mkdirSync(join(bf, 'calendar', 'scripts'), { recursive: true });
  writeFileSync(join(bf, 'calendar', 'scripts', 'calendar-ctl.sh'), '#!/bin/bash\nPORT=3100\n');
  io = { battlefieldsRoot: bf, homeRoot: tmp, now: () => 1000 };
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('discoverManagedApps', () => {
  it('finds apps by <slug>-ctl.sh convention and extracts PORT', () => {
    const rows = discoverManagedApps(io);
    const slugs = rows.map(r => r.slug).sort();
    expect(slugs).toEqual(['calendar', 'finances']);
    const finances = rows.find(r => r.slug === 'finances')!;
    expect(finances.launchdLabel).toBe('com.finances.app');
    expect(finances.healthUrl).toBe('http://localhost:3200/');
    expect(finances.logPath).toBe(join(tmp, '.finances', 'logs', 'finances.log'));
    expect(finances.isSelfControlled).toBe(false);
  });
});

describe('seedDevroomRow', () => {
  it('returns a devroom row with isSelfControlled = true', () => {
    const row = seedDevroomRow({ homeRoot: tmp, devroomRoot: '/opt/devroom', port: 7777, now: () => 1000 });
    expect(row.slug).toBe('devroom');
    expect(row.isSelfControlled).toBe(true);
    expect(row.ctlScriptPath).toBe('/opt/devroom/scripts/devroom-ctl.sh');
    expect(row.healthUrl).toBe('http://localhost:7777/');
  });
});
