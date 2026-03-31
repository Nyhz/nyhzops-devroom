import { vi } from 'vitest';

// --- Mock next/cache ---
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// --- Mock next/navigation ---
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// --- Mock next/headers ---
vi.mock('next/headers', () => ({
  cookies: () => new Map(),
  headers: () => new Map(),
}));

// --- Mock globalThis.orchestrator ---
globalThis.orchestrator = {
  startCampaign: vi.fn(),
  abortCampaign: vi.fn(),
  resumeCampaign: vi.fn(),
  skipAndContinueCampaign: vi.fn(),
  onMissionQueued: vi.fn(),
  activeCampaigns: new Map(),
} as unknown as typeof globalThis.orchestrator;

// --- Mock globalThis.io (Socket.IO) ---
const mockEmit = vi.fn();
const mockTo = vi.fn(() => ({ emit: mockEmit }));
globalThis.io = {
  emit: mockEmit,
  to: mockTo,
  in: mockTo,
} as unknown as typeof globalThis.io;
