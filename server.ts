import 'dotenv/config';
// Must be imported before Next.js internals — sets up AsyncLocalStorage on globalThis
import 'next/dist/server/node-environment-baseline';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import next from 'next';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { eq } from 'drizzle-orm';
import { getDatabase, runMigrations, closeDatabase } from './src/lib/db/index';
import { battlefields, campaigns, missions, managedApps } from './src/lib/db/schema';
import { OpsPoller } from './src/lib/ops/poller';
import { LogStreamManager } from './src/lib/ops/log-stream';
import { discoverManagedApps, seedDevroomRow } from './src/lib/ops/discovery';
import type { ManagedApp } from './src/lib/ops/types';
import { setupSocketIO } from './src/lib/socket/server';
import type { ClientToServerEvents, ServerToClientEvents } from './src/lib/socket/events';
import { config } from './src/lib/config';
import { Control } from './src/control/control';
import { setCommsEmitter } from './src/control/comms';
import { buildProductionDeps } from './src/control/production-deps';
import { DevServerManager } from './src/lib/process/dev-server';
import { Scheduler } from './src/lib/scheduler/scheduler';
import { telegramBot } from './src/lib/telegram/bot';
import { attachCallbackHandler } from './src/lib/telegram/notifier';
// Legacy telegram module kept for backwards-compatibility shim (isEnabled check).
import { isEnabled as telegramIsEnabled } from './src/lib/telegram/telegram';
import { handleTelegramCallback } from './src/lib/notifications/escalate';
import { setBootTimestamp, stopMetricsEmitter } from './src/lib/system-metrics';

// Global singletons (io, orchestrator, devServerManager, scheduler) are
// declared ambiently in src/types/globals.d.ts.

const dev = process.env.NODE_ENV !== 'production';
const SERVER_BOOT_TIME = Date.now();

async function start() {
  // 1. Database setup
  console.log('[DEVROOM] Initializing database...');
  getDatabase();
  runMigrations();

  // 2. Seed if needed
  const { seedIfEmpty } = await import('./scripts/seed');
  seedIfEmpty();

  // 3. Prepare Next.js
  const app = next({ dev, turbopack: true });
  const handle = app.getRequestHandler();
  await app.prepare();

  // 4. Create HTTP server
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  // 5. Attach Socket.IO
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, { path: '/socket.io' });
  globalThis.io = io;
  // Wire CONTROL's socket emitter — must be set before any mission dispatch
  // emits comms. Keep `globalThis.io` assigned too: legacy call sites
  // (escalate, dev-server, server actions) still read it directly.
  // Cast through unknown because the CONTROL Emitter shim is deliberately
  // open-typed (event: string) to accommodate emit sites not yet in
  // ServerToClientEvents. See src/lib/socket/events.ts for the scope note.
  setCommsEmitter((room, event, payload) =>
    (io.to(room).emit as (ev: string, arg: unknown) => boolean)(event, payload),
  );
  setupSocketIO(io);
  setBootTimestamp(SERVER_BOOT_TIME);

  // 5b. Start CONTROL (replaces old Orchestrator)
  const missionDeps = buildProductionDeps(io);
  const orchestrator = new Control({ missionDeps });
  globalThis.orchestrator = orchestrator;
  await orchestrator.start();
  console.log(`[DEVROOM] CONTROL online — ${config.maxAgents} agent slots`);

  // 5c. Dev server manager
  const devServerManager = new DevServerManager();
  globalThis.devServerManager = devServerManager;

  // 5d. Startup recovery: reset orphaned missions and campaigns from previous run
  const db = getDatabase();

  // Re-queue missions that were mid-flight when server stopped
  const orphanedStatuses = ['in_combat', 'deploying'];
  for (const s of orphanedStatuses) {
    const orphaned = db.select().from(missions)
      .where(eq(missions.status, s)).all();
    for (const m of orphaned) {
      db.update(missions).set({ status: 'queued', startedAt: null, updatedAt: Date.now() })
        .where(eq(missions.id, m.id)).run();
      console.log(`[DEVROOM] Mission ${m.id} re-queued — was ${s} when server stopped`);
    }
  }

  // Re-queue missions stuck in reviewing — CONTROL will pick them up and re-run review
  const reviewingMissions = db.select().from(missions)
    .where(eq(missions.status, 'reviewing')).all();
  for (const m of reviewingMissions) {
    db.update(missions).set({ status: 'queued', updatedAt: Date.now() })
      .where(eq(missions.id, m.id)).run();
    console.log(`[DEVROOM] Mission ${m.id} re-queued — was reviewing when server stopped`);
  }

  // Pause active campaigns (they'll resume their orphaned missions when unpaused)
  const activeCampaigns = db.select().from(campaigns)
    .where(eq(campaigns.status, 'active')).all();
  for (const c of activeCampaigns) {
    db.update(campaigns).set({ status: 'paused', updatedAt: Date.now() })
      .where(eq(campaigns.id, c.id)).run();
    console.log(`[DEVROOM] Campaign ${c.id} paused — server restarted`);
  }

  // 5e. Auto-start dev servers for flagged battlefields
  const autoStartBattlefields = db.select().from(battlefields)
    .where(eq(battlefields.autoStartDevServer, 1)).all();
  for (const bf of autoStartBattlefields) {
    if (bf.devServerCommand && bf.repoPath) {
      devServerManager.start(bf.id, bf.devServerCommand, bf.repoPath);
      console.log(`[DEVROOM] Auto-started dev server for ${bf.codename}`);
    }
  }

  // 5f. Scheduler
  const scheduler = new Scheduler();
  globalThis.scheduler = scheduler;
  scheduler.start();


  // 5h. Telegram bot + callback handler
  // Wire the callback handler once (idempotent) so escalation replies route
  // through answerEscalation. Start the long-polling loop fire-and-forget.
  attachCallbackHandler();
  // Legacy callback fallback for overseer escalation (kept until full cutover).
  if (telegramIsEnabled()) {
    telegramBot.on('callback_query', (payload) => {
      const cq = payload as { data?: string; message?: { message_id?: number } };
      if (cq.data) {
        handleTelegramCallback(cq.data, cq.message?.message_id ?? 0).catch((err) => {
          console.error('[DEVROOM] Telegram callback error:', err);
        });
      }
    });
  }
  telegramBot.start().catch((err) => {
    console.error('[DEVROOM] Telegram bot polling failed:', err);
  });
  console.log('[DEVROOM] Telegram bot polling active');

  // 5i. OPS: discovery + seed
  {
    const now = Date.now();
    const home = os.homedir();
    const devroomRoot = process.cwd();
    const battlefieldsRoot = path.resolve(devroomRoot, '..', 'battlefields');

    const rows = [
      seedDevroomRow({ homeRoot: home, devroomRoot, port: config.port, now: () => now }),
      ...discoverManagedApps({ battlefieldsRoot, homeRoot: home, now: () => now }),
    ];

    for (const row of rows) {
      db.insert(managedApps).values(row).onConflictDoUpdate({
        target: managedApps.slug,
        set: {
          displayName: row.displayName,
          launchdLabel: row.launchdLabel,
          ctlScriptPath: row.ctlScriptPath,
          logPath: row.logPath,
          healthUrl: row.healthUrl,
          isSelfControlled: row.isSelfControlled,
          updatedAt: now,
        },
      }).run();
    }
  }

  // 5j. OPS: log stream manager
  const logStreamManager = new LogStreamManager({
    emit: (slug, line) => io.to(`ops:logs:${slug}`).emit('ops:logs', { slug, line }),
  });
  globalThis.logStreamManager = logStreamManager;

  // 5k. OPS: poller
  const opsPoller = new OpsPoller({
    listApps: () => {
      return getDatabase().select().from(managedApps).orderBy(managedApps.orderIdx, managedApps.slug).all() as ManagedApp[];
    },
    runLaunchctl: (label) => new Promise((resolve) => {
      const uid = process.getuid?.() ?? 0;
      execFile('launchctl', ['print', `gui/${uid}/${label}`], { timeout: 2000 }, (_err, stdout) => resolve(stdout || ''));
    }),
    runPs: (pid) => new Promise((resolve) => {
      execFile('ps', ['-o', 'rss=,%cpu=', '-p', String(pid)], { timeout: 2000 }, (_err, stdout) => resolve(stdout || ''));
    }),
    probeHealth: async (url) => {
      if (!url) return { healthy: false, httpCode: null, latencyMs: null };
      const started = Date.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
        return { healthy: res.ok, httpCode: res.status, latencyMs: Date.now() - started };
      } catch {
        return { healthy: false, httpCode: null, latencyMs: Date.now() - started };
      }
    },
    readMode: (slug) => {
      try {
        const modeFile = path.join(os.homedir(), `.${slug}`, 'mode');
        return fs.readFileSync(modeFile, 'utf-8').trim() as 'prod' | 'dev';
      } catch { return 'unknown'; }
    },
    emit: (snapshot) => io.to('ops:status').emit('ops:status', snapshot),
    now: () => Date.now(),
  });
  globalThis.opsPoller = opsPoller;
  opsPoller.start(3000);

  // 6. Detect local IP
  const localIP = getLocalIP();

  // 7. Start listening
  httpServer.listen(config.port, config.host, () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  NYHZ OPS — DEVROOM');
    console.log('  Status:  OPERATIONAL');
    console.log(`  Local:   http://localhost:${config.port}`);
    console.log(`  Network: http://${localIP}:${config.port}`);
    console.log(`  Agents:  0/${config.maxAgents} deployed`);
    console.log('═══════════════════════════════════════════');
    console.log('');
  });

  // 8. Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return; // Prevent double-shutdown from rapid Ctrl+C
    shuttingDown = true;

    console.log('\n[DEVROOM] STANDING DOWN...');
    stopMetricsEmitter();
    telegramBot.stop();
    scheduler.stop();
    devServerManager.stopAll();
    opsPoller.stop();
    logStreamManager.shutdown();
    await orchestrator.stop();

    // Force exit after 5 seconds if graceful close hangs
    const forceExit = setTimeout(() => {
      console.log('[DEVROOM] Force exit — connections did not drain in time.');
      process.exit(0);
    }, 5000);
    forceExit.unref(); // Don't let this timer keep the process alive

    try {
      io.close();
      httpServer.close();
      closeDatabase();
      console.log('[DEVROOM] All systems offline. Goodbye, Commander.');
      process.exit(0);
    } catch {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

start().catch((err) => {
  console.error('[DEVROOM] Fatal startup error:', err);
  process.exit(1);
});
