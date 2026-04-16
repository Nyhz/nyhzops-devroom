import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { ForensicPruneForm } from '../ForensicPruneForm';

// ---------------------------------------------------------------------------
// Mock Server Actions
// ---------------------------------------------------------------------------
const mockPruneForensicBranches = vi.fn();

vi.mock('@/actions/battlefield', () => ({
  pruneForensicBranches: (...args: unknown[]) => mockPruneForensicBranches(...args),
}));

// useConfirm mock — resolves index 0 (confirm) immediately
vi.mock('@/hooks/use-confirm', () => ({
  useConfirm: () => [
    vi.fn().mockResolvedValue(0),
    () => null,
  ],
}));

const BATTLEFIELD_ID = 'bf_test_001';

describe('ForensicPruneForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the days-old input and PRUNE button', () => {
    renderWithProviders(<ForensicPruneForm battlefieldId={BATTLEFIELD_ID} />);

    expect(screen.getByLabelText(/days old/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /prune/i })).toBeInTheDocument();
  });

  it('defaults daysOld to 7', () => {
    renderWithProviders(<ForensicPruneForm battlefieldId={BATTLEFIELD_ID} />);

    const input = screen.getByLabelText(/days old/i) as HTMLInputElement;
    expect(input.value).toBe('7');
  });

  it('shows error when daysOld is 0 and prune is clicked', async () => {
    const { user } = renderWithProviders(<ForensicPruneForm battlefieldId={BATTLEFIELD_ID} />);

    const input = screen.getByLabelText(/days old/i);
    // Clear existing value and type 0
    await user.tripleClick(input);
    await user.keyboard('0');

    await user.click(screen.getByRole('button', { name: /prune/i }));

    await waitFor(() => {
      expect(screen.getByText(/days must be a positive integer/i)).toBeInTheDocument();
    });

    expect(mockPruneForensicBranches).not.toHaveBeenCalled();
  });

  it('calls pruneForensicBranches with battlefieldId and correct daysOld', async () => {
    mockPruneForensicBranches.mockResolvedValueOnce({ pruned: [] });

    const { user } = renderWithProviders(<ForensicPruneForm battlefieldId={BATTLEFIELD_ID} />);

    // The default value is 7 — click prune directly
    await user.click(screen.getByRole('button', { name: /prune/i }));

    await waitFor(() => {
      expect(mockPruneForensicBranches).toHaveBeenCalledWith(BATTLEFIELD_ID, 7);
    });
  });

  it('shows pruned branch list when branches are pruned', async () => {
    mockPruneForensicBranches.mockResolvedValueOnce({
      pruned: ['forensic/fix-1', 'forensic/fix-2', 'forensic/fix-3'],
    });

    const { user } = renderWithProviders(<ForensicPruneForm battlefieldId={BATTLEFIELD_ID} />);
    await user.click(screen.getByRole('button', { name: /prune/i }));

    await waitFor(() => {
      expect(screen.getByText(/pruned 3 branch/i)).toBeInTheDocument();
      expect(screen.getByText(/forensic\/fix-1/)).toBeInTheDocument();
      expect(screen.getByText(/forensic\/fix-2/)).toBeInTheDocument();
      expect(screen.getByText(/forensic\/fix-3/)).toBeInTheDocument();
    });
  });

  it('shows "no branches found" message when result is empty', async () => {
    mockPruneForensicBranches.mockResolvedValueOnce({ pruned: [] });

    const { user } = renderWithProviders(<ForensicPruneForm battlefieldId={BATTLEFIELD_ID} />);
    await user.click(screen.getByRole('button', { name: /prune/i }));

    await waitFor(() => {
      expect(screen.getByText(/no branches older than 7 day/i)).toBeInTheDocument();
    });
  });

  it('does not call pruneForensicBranches when action is skipped on validation failure', async () => {
    const { user } = renderWithProviders(<ForensicPruneForm battlefieldId={BATTLEFIELD_ID} />);

    // Enter 0 to trigger validation error path before confirm
    const input = screen.getByLabelText(/days old/i);
    await user.tripleClick(input);
    await user.keyboard('0');
    await user.click(screen.getByRole('button', { name: /prune/i }));

    await waitFor(() => {
      expect(screen.getByText(/days must be a positive integer/i)).toBeInTheDocument();
    });
    expect(mockPruneForensicBranches).not.toHaveBeenCalled();
  });
});
