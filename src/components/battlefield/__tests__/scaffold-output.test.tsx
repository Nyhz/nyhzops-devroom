import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { ScaffoldOutput } from '../scaffold-output';

// Mock socket hooks
vi.mock('@/hooks/use-socket', () => ({
  useSocket: () => null,
  useReconnectKey: () => 0,
}));

// Mock fetch for buffered logs
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    json: () => Promise.resolve({ logs: null, exitCode: null, isComplete: false }),
  });
});

describe('ScaffoldOutput', () => {
  it('renders SCAFFOLD header', () => {
    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(screen.getByText('SCAFFOLD')).toBeInTheDocument();
  });

  it('shows Running status initially', () => {
    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(screen.getByText('Running...')).toBeInTheDocument();
  });

  it('shows Complete status when fetch returns exitCode 0 and isComplete', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ logs: '', exitCode: 0, isComplete: true }),
    });

    const { findByText } = renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(await findByText('Complete')).toBeInTheDocument();
    expect(await findByText(/Exit 0/)).toBeInTheDocument();
  });

  it('shows Failed status when fetch returns non-zero exitCode and isComplete', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ logs: '', exitCode: 1, isComplete: true }),
    });

    const { findByText } = renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(await findByText('Failed')).toBeInTheDocument();
    expect(await findByText(/Exit 1/)).toBeInTheDocument();
  });

  it('does not show exit footer while running', () => {
    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(screen.queryByText(/Exit/)).not.toBeInTheDocument();
  });

  it('fetches buffered logs on mount', () => {
    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    expect(mockFetch).toHaveBeenCalledWith('/api/battlefields/bf-1/scaffold/logs');
  });

  it('renders Terminal component', () => {
    renderWithProviders(<ScaffoldOutput battlefieldId="bf-1" />);
    // Terminal container should be present
    const terminal = document.querySelector('.font-data');
    expect(terminal).toBeInTheDocument();
  });
});
