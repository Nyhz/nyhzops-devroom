import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// --- Mock next/navigation ---
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// --- Mock next/link ---
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => {
    const { createElement } = require('react');
    return createElement('a', { href, ...props }, children);
  },
}));

// --- Mock Socket.IO provider ---
const mockSocket = {
  id: 'mock-socket-id',
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('@/components/providers/socket-provider', () => ({
  SocketProvider: ({ children }: { children: React.ReactNode }) => children,
  useSocketContext: () => ({ socket: mockSocket, reconnectKey: 0 }),
}));

vi.mock('@/hooks/use-socket', () => ({
  useSocket: () => mockSocket,
  useReconnectKey: () => 0,
}));

export { mockSocket };
