import 'dotenv/config';
// Must be imported before Next.js internals — sets up AsyncLocalStorage on globalThis
import 'next/dist/server/node-environment-baseline';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import next from 'next';
import os from 'os';
import { eq } from 'drizzle-orm';
import { getDatabase, runMigrations, closeDatabase } from './src/lib/db/index';
import { battlefields, campaigns, missions } from './src/lib/db/schema';
import { setupSocketIO } from './src/lib/socket/server';
import { config } from './src/lib/config';
import { Control } from './src/control/control';
import { buildProductionDeps } from './src/control/production-deps';
import { DevServerManager } from './src/lib/process/dev-server';
import { Scheduler } from './src/lib/scheduler/scheduler';
import { telegramBot } from './src/lib/telegram/bot';
import { attachCallbackHandler } from './src/lib/telegram/notifier';
// Legacy telegram module kept for backwards-compatibility shim (isEnabled check).
import { isEnabled as telegramIsEnabled } from './src/lib/telegram/telegram';
import { handleTelegramCallback } from './src/lib/notifications/escalate';
import { setBootTimestamp, stopMetricsEmitter } from './src/lib/system-metrics';

// Typed globalThis for Socket.IO access
declare global {
  var io: SocketIOServer | undefined;
  var orchestrator: Control | undefined;
  var devServerManager: DevServerManager | undefined;
  var scheduler: Scheduler | undefined;
}

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
  const io = new SocketIOServer(httpServer, { path: '/socket.io' });
  globalThis.io = io;
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
