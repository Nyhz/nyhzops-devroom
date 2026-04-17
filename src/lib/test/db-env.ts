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

// Hard-disable outbound Telegram during tests. Without this, tests that
// exercise the real escalate()/notifier paths (e.g. notifier.test.ts) will
// POST to the real bot API whenever the inherited shell env carries
// DEVROOM_TELEGRAM_ENABLED=true — which is exactly what happens when a
// mission's agent runs `pnpm test` inside a worktree (the DEVROOM service
// loads .env.local, the agent inherits it). Result: real Telegram spam to
// the Commander on every test run. Clamp here before any module reads it.
process.env.DEVROOM_TELEGRAM_ENABLED = 'false';
delete process.env.DEVROOM_TELEGRAM_BOT_TOKEN;
delete process.env.DEVROOM_TELEGRAM_CHAT_ID;

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
