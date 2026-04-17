// IMPORTANT: must be the first import — sets DEVROOM_DB_PATH to a per-worker
// temp file before any module loads config.ts. ES modules are evaluated in
// import order (depth-first), so this side-effect runs before subsequent imports.
import './db-env';

import { vi } from 'vitest';
import { runMigrations } from '@/lib/db';
import { seedIfEmpty } from '../../../scripts/seed';

// --- Mock next/cache ---
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// --- Mock next/headers ---
vi.mock('next/headers', () => ({
  cookies: () => new Map(),
  headers: () => new Map(),
}));

// --- Mock globalThis.orchestrator (Control) ---
globalThis.orchestrator = {
  live: new Map(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  killMission: vi.fn().mockReturnValue(false),
} as unknown as typeof globalThis.orchestrator;

// --- Mock globalThis.io (Socket.IO) ---
const mockEmit = vi.fn();
const mockTo = vi.fn(() => ({ emit: mockEmit }));
const mockIn = vi.fn(() => ({ emit: mockEmit }));

globalThis.io = {
  emit: mockEmit,
  to: mockTo,
  in: mockIn,
} as unknown as typeof globalThis.io;

// --- DB lifecycle: per-worker temp file, migrate + seed once per worker ---
runMigrations();
seedIfEmpty();
