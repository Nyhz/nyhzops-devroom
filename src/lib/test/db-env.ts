import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Side-effect-only module: sets DEVROOM_DB_PATH to a per-worker temp file
// BEFORE config.ts is loaded. Imported at the very top of setup.ts so it
// runs before any module that reads config.dbPath. Without this, tests
// share the live ./devroom.db, polluting it with fixtures (bf-1,
// bf-ctl-scaffold, bf-campaign-executor, etc.) and producing nondeterministic
// failures when prior runs leave residue.

const workerId = process.env.VITEST_WORKER_ID ?? '0';
const dbPath = path.join(os.tmpdir(), `devroom-test-${process.pid}-${workerId}.db`);

for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try {
    fs.unlinkSync(p);
  } catch {
    // not present — fine
  }
}

process.env.DEVROOM_DB_PATH = dbPath;

// Clean up the temp DB (and its WAL/SHM sidecars) when this worker exits so
// /tmp doesn't accumulate stale devroom-test-*.db files across runs.
process.on('exit', () => {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.unlinkSync(p);
    } catch {
      // already gone — fine
    }
  }
});
