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
  onMissionQueued: vi.fn(),
  onMissionAbort: vi.fn(),
  queueMission: vi.fn(),
  abortMission: vi.fn(),
} as unknown as typeof globalThis.orchestrator;

// --- Mock globalThis.io (Socket.IO) ---
const emitMock = vi.fn();
const toMock = vi.fn(() => ({ emit: emitMock }));
const inMock = vi.fn(() => ({ emit: emitMock }));

globalThis.io = {
  emit: emitMock,
  to: toMock,
  in: inMock,
} as unknown as typeof globalThis.io;
