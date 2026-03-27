import 'dotenv/config';
// Must be imported before Next.js internals — sets up AsyncLocalStorage on globalThis
import 'next/dist/server/node-environment-baseline';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import next from 'next';
import os from 'os';
import { eq } from 'drizzle-orm';
import { getDatabase, runMigrations, closeDatabase } from './src/lib/db/index';
import { battlefields, campaigns } from './src/lib/db/schema';
import { setupSocketIO } from './src/lib/socket/server';
import { config } from './src/lib/config';
import { Orchestrator } from './src/lib/orchestrator/orchestrator';
import { DevServerManager } from './src/lib/process/dev-server';
import { Scheduler } from './src/lib/scheduler/scheduler';
import { isEnabled as telegramIsEnabled, startPolling as startTelegramPolling, stopPolling as stopTelegramPolling } from './src/lib/telegram/telegram';
import { handleTelegramCallback } from './src/lib/captain/escalation';

// Typed globalThis for Socket.IO access
declare global {
  // eslint-disable-next-line no-var
  var io: SocketIOServer | undefined;
  // eslint-disable-next-line no-var
  var orchestrator: Orchestrator | undefined;
  // eslint-disable-next-line no-var
  var devServerManager: DevServerManager | undefined;
  // eslint-disable-next-line no-var
  var scheduler: Scheduler | undefined;
}

const dev = process.env.NODE_ENV !== 'production';

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

  // 5b. Create orchestrator
  const orchestrator = new Orchestrator(io);
  globalThis.orchestrator = orchestrator;
  console.log(`[DEVROOM] Orchestrator online — ${config.maxAgents} agent slots`);

  // 5c. Dev server manager
  const devServerManager = new DevServerManager();
  globalThis.devServerManager = devServerManager;

  // 5d. Startup recovery: pause any campaigns that were active when server stopped
  const db = getDatabase();
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


  // 5h. Telegram polling
  if (telegramIsEnabled()) {
    startTelegramPolling((callbackData, messageId) => {
      handleTelegramCallback(callbackData, messageId).catch((err) => {
        console.error('[DEVROOM] Telegram callback error:', err);
      });
    });
    console.log('[DEVROOM] Telegram bot polling active');
  }

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
    stopTelegramPolling();
    scheduler.stop();
    devServerManager.stopAll();
    await orchestrator.shutdown();

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
