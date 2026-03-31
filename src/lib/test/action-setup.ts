import { vi } from 'vitest';

// --- Mock next/cache (used by all server actions) ---
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// --- Mock globalThis.orchestrator ---
globalThis.orchestrator = {
  queueMission: vi.fn(),
  abortMission: vi.fn(),
  getRunningCount: vi.fn().mockReturnValue(0),
  getQueuedCount: vi.fn().mockReturnValue(0),
} as unknown as typeof globalThis.orchestrator;

// --- Mock globalThis.io (Socket.IO) ---
const mockEmit = vi.fn();
const mockTo = vi.fn().mockReturnValue({ emit: mockEmit });
globalThis.io = {
  emit: mockEmit,
  to: mockTo,
  in: mockTo,
} as unknown as typeof globalThis.io;
