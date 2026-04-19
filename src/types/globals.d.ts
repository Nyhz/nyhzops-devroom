// Ambient declarations for DEVROOM's shared globalThis singletons.
//
// Centralized here so every module that reads `globalThis.io`,
// `globalThis.orchestrator`, etc. gets the same type without needing a
// per-file `declare global` block. The runtime assignments live in
// `server.ts` during boot.

import type { Server as SocketIOServer } from 'socket.io';
import type { Control } from '../control/control';
import type { DevServerManager } from '../lib/process/dev-server';
import type { Scheduler } from '../lib/scheduler/scheduler';

declare global {
  // Intentionally typed loosely for `io` — many legacy call sites
  // (dev-server, escalate, server actions) emit events that are not yet
  // in ServerToClientEvents. Incremental tightening will follow.
  var io: SocketIOServer | undefined;
  var orchestrator: Control | undefined;
  var devServerManager: DevServerManager | undefined;
  var scheduler: Scheduler | undefined;
  var opsPoller: import('../lib/ops/poller').OpsPoller | undefined;
  var logStreamManager: import('../lib/ops/log-stream').LogStreamManager | undefined;
}

export {};
