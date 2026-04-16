import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { MainRedOverrideToggle } from '../MainRedOverrideToggle';

// ---------------------------------------------------------------------------
// Mock Server Actions
// ---------------------------------------------------------------------------
const mockToggleMainRedOverride = vi.fn();

vi.mock('@/actions/battlefield', () => ({
  toggleMainRedOverride: (...args: unknown[]) => mockToggleMainRedOverride(...args),
}));

const BATTLEFIELD_ID = 'bf_test_001';

describe('MainRedOverrideToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the toggle in OFF state when initialEnabled=false', () => {
    renderWithProviders(
      <MainRedOverrideToggle
        battlefieldId={BATTLEFIELD_ID}
        initialEnabled={false}
      />,
    );

    const toggle = screen.getByRole('switch', { name: /main-red override toggle/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('renders the toggle in ON state when initialEnabled=true', () => {
    renderWithProviders(
      <MainRedOverrideToggle
        battlefieldId={BATTLEFIELD_ID}
        initialEnabled={true}
      />,
    );

    const toggle = screen.getByRole('switch', { name: /main-red override toggle/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('shows warning message when enabled=true', () => {
    renderWithProviders(
      <MainRedOverrideToggle
        battlefieldId={BATTLEFIELD_ID}
        initialEnabled={true}
      />,
    );

    expect(screen.getByText(/operations may proceed with a failing main branch/i)).toBeInTheDocument();
  });

  it('does not show warning when disabled', () => {
    renderWithProviders(
      <MainRedOverrideToggle
        battlefieldId={BATTLEFIELD_ID}
        initialEnabled={false}
      />,
    );

    // Warning text should not appear in the red warning box (it's in the description but not the warning box)
    const warnings = screen.queryAllByText(/Operations may proceed with a failing main branch/);
    // There should be at most 0 red-warning boxes (the toggle description text doesn't contain exactly that)
    expect(warnings).toHaveLength(0);
  });

  it('calls toggleMainRedOverride(id, true) when toggled from OFF to ON', async () => {
    mockToggleMainRedOverride.mockResolvedValueOnce(undefined);

    const { user } = renderWithProviders(
      <MainRedOverrideToggle
        battlefieldId={BATTLEFIELD_ID}
        initialEnabled={false}
      />,
    );

    await user.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(mockToggleMainRedOverride).toHaveBeenCalledWith(BATTLEFIELD_ID, true);
    });
  });

  it('calls toggleMainRedOverride(id, false) when toggled from ON to OFF', async () => {
    mockToggleMainRedOverride.mockResolvedValueOnce(undefined);

    const { user } = renderWithProviders(
      <MainRedOverrideToggle
        battlefieldId={BATTLEFIELD_ID}
        initialEnabled={true}
      />,
    );

    await user.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(mockToggleMainRedOverride).toHaveBeenCalledWith(BATTLEFIELD_ID, false);
    });
  });

  it('flips the aria-checked state after toggle', async () => {
    mockToggleMainRedOverride.mockResolvedValueOnce(undefined);

    const { user } = renderWithProviders(
      <MainRedOverrideToggle
        battlefieldId={BATTLEFIELD_ID}
        initialEnabled={false}
      />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle);

    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
  });
});
