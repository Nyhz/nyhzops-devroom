import { vi } from 'vitest';

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: () => new Map(),
  headers: () => new Map(),
}));

// Mock orchestrator global
globalThis.orchestrator = {
  execute: vi.fn(),
  abort: vi.fn(),
  getStatus: vi.fn(),
  getRunningMissions: vi.fn(() => []),
} as unknown as typeof globalThis.orchestrator;

// Mock Socket.IO global
globalThis.io = {
  emit: vi.fn(),
  to: vi.fn(() => globalThis.io),
  in: vi.fn(() => globalThis.io),
} as unknown as typeof globalThis.io;
