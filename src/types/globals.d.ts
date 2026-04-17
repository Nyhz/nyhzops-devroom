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
  // eslint-disable-next-line no-var
  var io: SocketIOServer | undefined;
  // eslint-disable-next-line no-var
  var orchestrator: Control | undefined;
  // eslint-disable-next-line no-var
  var devServerManager: DevServerManager | undefined;
  // eslint-disable-next-line no-var
  var scheduler: Scheduler | undefined;
}

export {};
