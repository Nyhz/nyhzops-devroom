import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { ScaffoldOutput } from '../scaffold-output';

// Mock useCommandOutput hook
const mockPrependBufferedLogs = vi.fn();
const mockCommandOutput = {
  logs: [] as Array<{ content: string; timestamp: number }>,
  exitCode: null as number | null,
  isRunning: true,
  prependBufferedLogs: mockPrependBufferedLogs,
};

vi.mock('@/hooks/use-command-output', () => ({
  useCommandOutput: () => mockCommandOutput,
}));

// Mock fetch for buffered logs
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockCommandOutput.logs = [];
  mockCommandOutput.exitCode = null;
  mockCommandOutput.isRunning = true;
  mockFetch.mockResolvedValue({
    json: () => Promise.resolve({ logs: null }),
  });
});

describe('ScaffoldOutput', () => {
  it('renders SCAFFOLD header', () => {
    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(screen.getByText('SCAFFOLD')).toBeInTheDocument();
  });

  it('shows Running status when isRunning is true', () => {
    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(screen.getByText('Running...')).toBeInTheDocument();
  });

  it('shows Complete status when exitCode is 0', () => {
    mockCommandOutput.isRunning = false;
    mockCommandOutput.exitCode = 0;

    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText(/Exit 0/)).toBeInTheDocument();
  });

  it('shows Failed status when exitCode is non-zero', () => {
    mockCommandOutput.isRunning = false;
    mockCommandOutput.exitCode = 1;

    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/Exit 1/)).toBeInTheDocument();
  });

  it('does not show exit footer while running', () => {
    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(screen.queryByText(/Exit/)).not.toBeInTheDocument();
  });

  it('fetches buffered logs on mount', () => {
    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(mockFetch).toHaveBeenCalledWith('/api/battlefields/bf-1/scaffold/logs');
  });

  it('renders Terminal component with converted logs', () => {
    mockCommandOutput.logs = [
      { content: 'line 1\n', timestamp: 100 },
      { content: 'line 2\n', timestamp: 200 },
    ];

    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    // Terminal may merge consecutive logs — check combined text
    expect(screen.getByText(/line 1/)).toBeInTheDocument();
    expect(screen.getByText(/line 2/)).toBeInTheDocument();
  });
});
