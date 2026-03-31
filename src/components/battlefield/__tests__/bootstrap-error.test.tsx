import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { BootstrapError } from '../bootstrap-error';

// Mock server actions
const mockRegenerateBootstrap = vi.fn();
const mockAbandonBootstrap = vi.fn();
vi.mock('@/actions/battlefield', () => ({
  regenerateBootstrap: (...args: unknown[]) => mockRegenerateBootstrap(...args),
  abandonBootstrap: (...args: unknown[]) => mockAbandonBootstrap(...args),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock next/navigation with trackable fns
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
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

// Mock useConfirm hook
let confirmResolver: ((value: number) => void) | null = null;
vi.mock('@/hooks/use-confirm', () => ({
  useConfirm: () => {
    const confirm = () =>
      new Promise<number>((resolve) => {
        confirmResolver = resolve;
      });
    const ConfirmDialog = () => null;
    return [confirm, ConfirmDialog];
  },
}));

const defaultProps = {
  battlefieldId: 'bf-1',
  codename: 'ALPHA',
  debrief: 'Process exited with error',
  initialBriefing: 'Analyze the repo',
};

beforeEach(() => {
  vi.clearAllMocks();
  confirmResolver = null;
  mockRegenerateBootstrap.mockResolvedValue(undefined);
  mockAbandonBootstrap.mockResolvedValue(undefined);
});

describe('BootstrapError', () => {
  it('renders codename with BOOTSTRAP FAILED label', () => {
    renderWithProviders(<BootstrapError {...defaultProps} />);
    expect(
      screen.getByText('ALPHA — BOOTSTRAP FAILED'),
    ).toBeInTheDocument();
  });

  it('renders error description text', () => {
    renderWithProviders(<BootstrapError {...defaultProps} />);
    expect(
      screen.getByText('Intelligence generation encountered resistance.'),
    ).toBeInTheDocument();
  });

  it('renders debrief text when provided', () => {
    renderWithProviders(<BootstrapError {...defaultProps} />);
    expect(
      screen.getByText('Process exited with error'),
    ).toBeInTheDocument();
  });

  it('does not render debrief when empty', () => {
    renderWithProviders(
      <BootstrapError {...defaultProps} debrief="" />,
    );
    expect(
      screen.queryByText('Process exited with error'),
    ).not.toBeInTheDocument();
  });

  it('renders RETRY BOOTSTRAP and ABANDON buttons', () => {
    renderWithProviders(<BootstrapError {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: 'RETRY BOOTSTRAP' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'ABANDON' }),
    ).toBeInTheDocument();
  });

  it('calls regenerateBootstrap and refresh on retry click', async () => {
    const { user } = renderWithProviders(
      <BootstrapError {...defaultProps} />,
    );

    await user.click(screen.getByRole('button', { name: 'RETRY BOOTSTRAP' }));

    await waitFor(() => {
      expect(mockRegenerateBootstrap).toHaveBeenCalledWith(
        'bf-1',
        'Analyze the repo',
      );
    });
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('shows toast on retry error', async () => {
    const { toast } = await import('sonner');
    mockRegenerateBootstrap.mockRejectedValue(new Error('Server error'));

    const { user } = renderWithProviders(
      <BootstrapError {...defaultProps} />,
    );
    await user.click(screen.getByRole('button', { name: 'RETRY BOOTSTRAP' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Server error');
    });
  });

  it('calls abandonBootstrap and navigates home on confirm', async () => {
    const { user } = renderWithProviders(
      <BootstrapError {...defaultProps} />,
    );

    await user.click(screen.getByRole('button', { name: 'ABANDON' }));

    // Simulate confirm dialog accepting (index 0 = first action)
    await waitFor(() => {
      expect(confirmResolver).not.toBeNull();
    });
    confirmResolver!(0);

    await waitFor(() => {
      expect(mockAbandonBootstrap).toHaveBeenCalledWith('bf-1');
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('does not abandon when confirm is cancelled', async () => {
    const { user } = renderWithProviders(
      <BootstrapError {...defaultProps} />,
    );

    await user.click(screen.getByRole('button', { name: 'ABANDON' }));

    await waitFor(() => {
      expect(confirmResolver).not.toBeNull();
    });
    confirmResolver!(-1); // Cancel

    // Wait a tick and verify abandon was NOT called
    await waitFor(() => {
      expect(mockAbandonBootstrap).not.toHaveBeenCalled();
    });
  });

  it('disables buttons while pending', async () => {
    mockRegenerateBootstrap.mockReturnValue(new Promise(() => {}));

    const { user } = renderWithProviders(
      <BootstrapError {...defaultProps} />,
    );
    await user.click(screen.getByRole('button', { name: 'RETRY BOOTSTRAP' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'RETRY BOOTSTRAP' }),
      ).toBeDisabled();
      expect(screen.getByRole('button', { name: 'ABANDON' })).toBeDisabled();
    });
  });
});
