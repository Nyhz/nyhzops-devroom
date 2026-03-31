import { vi } from 'vitest';

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

// --- Mock globalThis.orchestrator ---
globalThis.orchestrator = {
  execute: vi.fn(),
  abort: vi.fn(),
  getStatus: vi.fn(),
  executeMission: vi.fn(),
  abortMission: vi.fn(),
  queueMission: vi.fn(),
  getRunningMissions: vi.fn(() => []),
  getQueuedMissions: vi.fn(() => []),
  getRunningCount: vi.fn().mockReturnValue(0),
  getQueuedCount: vi.fn().mockReturnValue(0),
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
