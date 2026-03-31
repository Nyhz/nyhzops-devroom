import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { ScaffoldRetry } from '../scaffold-retry';

// Mock next/navigation with trackable fns
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: mockRefresh,
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

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true });
});

describe('ScaffoldRetry', () => {
  it('renders SCAFFOLD Failed header', () => {
    renderWithProviders(<ScaffoldRetry battlefieldId="bf-1" />);
    expect(screen.getByText('SCAFFOLD')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('renders message to Commander', () => {
    renderWithProviders(<ScaffoldRetry battlefieldId="bf-1" />);
    expect(
      screen.getByText(/Commander, the scaffold operation was compromised/),
    ).toBeInTheDocument();
  });

  it('renders RETRY SCAFFOLD button', () => {
    renderWithProviders(<ScaffoldRetry battlefieldId="bf-1" />);
    expect(
      screen.getByRole('button', { name: 'RETRY SCAFFOLD' }),
    ).toBeInTheDocument();
  });

  it('calls fetch POST and router.refresh on retry click', async () => {
    const { user } = renderWithProviders(<ScaffoldRetry battlefieldId="bf-1" />);

    await user.click(screen.getByRole('button', { name: 'RETRY SCAFFOLD' }));

    expect(mockFetch).toHaveBeenCalledWith('/api/battlefields/bf-1/scaffold', {
      method: 'POST',
    });
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('shows RETRYING... text while pending', async () => {
    // Never resolve to keep pending state
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { user } = renderWithProviders(<ScaffoldRetry battlefieldId="bf-1" />);
    await user.click(screen.getByRole('button', { name: 'RETRY SCAFFOLD' }));

    expect(screen.getByRole('button', { name: 'RETRYING...' })).toBeDisabled();
  });

  it('re-enables button on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { user } = renderWithProviders(<ScaffoldRetry battlefieldId="bf-1" />);
    await user.click(screen.getByRole('button', { name: 'RETRY SCAFFOLD' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'RETRY SCAFFOLD' }),
      ).not.toBeDisabled();
    });
  });
});
