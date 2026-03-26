import 'dotenv/config';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import next from 'next';
import os from 'os';
import { getDatabase, runMigrations, closeDatabase } from './src/lib/db/index';
import { setupSocketIO } from './src/lib/socket/server';
import { config } from './src/lib/config';
import { Orchestrator } from './src/lib/orchestrator/orchestrator';

// Typed globalThis for Socket.IO access
declare global {
  // eslint-disable-next-line no-var
  var io: SocketIOServer | undefined;
  // eslint-disable-next-line no-var
  var orchestrator: Orchestrator | undefined;
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
  const shutdown = async () => {
    console.log('\n[DEVROOM] STANDING DOWN...');
    await orchestrator.shutdown();
    httpServer.close(() => {
      io.close(() => {
        closeDatabase();
        console.log('[DEVROOM] All systems offline. Goodbye, Commander.');
        process.exit(0);
      });
    });
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
