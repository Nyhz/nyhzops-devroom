import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { GateManifestEditor } from '../GateManifestEditor';
import type { GateManifest, GateRunResults } from '@/control/gates';

// ---------------------------------------------------------------------------
// Mock Server Actions
// ---------------------------------------------------------------------------
const mockUpdateGateManifest = vi.fn();
const mockEstablishGates = vi.fn();

vi.mock('@/actions/battlefield', () => ({
  updateGateManifest: (...args: unknown[]) => mockUpdateGateManifest(...args),
  establishGates: (...args: unknown[]) => mockEstablishGates(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BATTLEFIELD_ID = 'bf_test_001';

const INITIAL_MANIFEST: GateManifest = {
  build: 'pnpm build',
  test: 'pnpm test',
  lint: 'pnpm lint',
  typecheck: 'pnpm typecheck',
};

function buildPassResults(): GateRunResults {
  return {
    overallStatus: 'pass',
    results: [
      { gate: 'lint', status: 'pass', stdout: '', stderr: '', durationMs: 120 },
      { gate: 'typecheck', status: 'pass', stdout: '', stderr: '', durationMs: 350 },
      { gate: 'build', status: 'pass', stdout: '', stderr: '', durationMs: 900 },
      { gate: 'test', status: 'pass', stdout: '', stderr: '', durationMs: 400 },
    ],
  };
}

function buildFailResults(): GateRunResults {
  return {
    overallStatus: 'fail',
    results: [
      { gate: 'lint', status: 'fail', stdout: '', stderr: 'Linting failed', durationMs: 80 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GateManifestEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 4 gate input fields prefilled from props', () => {
    renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={INITIAL_MANIFEST}
      />,
    );

    expect(screen.getByDisplayValue('pnpm build')).toBeInTheDocument();
    expect(screen.getByDisplayValue('pnpm test')).toBeInTheDocument();
    expect(screen.getByDisplayValue('pnpm lint')).toBeInTheDocument();
    expect(screen.getByDisplayValue('pnpm typecheck')).toBeInTheDocument();
  });

  it('renders empty fields when initialManifest is null', () => {
    renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={null}
      />,
    );

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(4);
    for (const input of inputs) {
      expect(input).toHaveValue('');
    }
  });

  it('renders VERIFY AGAINST HEAD and SAVE buttons', () => {
    renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={INITIAL_MANIFEST}
      />,
    );

    expect(screen.getByRole('button', { name: /verify against head/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('SAVE is disabled initially (no verify and no ALLOW UNVERIFIED SAVE)', () => {
    renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={INITIAL_MANIFEST}
      />,
    );

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();
  });

  it('VERIFY AGAINST HEAD calls updateGateManifest with { verify: true } and renders per-gate results', async () => {
    const passResults = buildPassResults();
    mockUpdateGateManifest.mockResolvedValueOnce({
      persisted: true,
      verifyResults: passResults,
    });

    const { user } = renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={INITIAL_MANIFEST}
      />,
    );

    await user.click(screen.getByRole('button', { name: /verify against head/i }));

    await waitFor(() => {
      expect(mockUpdateGateManifest).toHaveBeenCalledWith(
        BATTLEFIELD_ID,
        INITIAL_MANIFEST,
        { verify: true },
      );
    });

    // Per-gate result rows should appear
    await waitFor(() => {
      expect(screen.getByText('lint')).toBeInTheDocument();
      expect(screen.getByText('build')).toBeInTheDocument();
    });

    // Pass status labels should appear
    const passLabels = screen.getAllByText('PASS');
    expect(passLabels.length).toBeGreaterThan(0);
  });

  it('SAVE is enabled after a successful verify', async () => {
    mockUpdateGateManifest.mockResolvedValueOnce({
      persisted: true,
      verifyResults: buildPassResults(),
    });

    const { user } = renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={INITIAL_MANIFEST}
      />,
    );

    await user.click(screen.getByRole('button', { name: /verify against head/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
    });
  });

  it('SAVE remains disabled after a failed verify', async () => {
    mockUpdateGateManifest.mockResolvedValueOnce({
      persisted: false,
      verifyResults: buildFailResults(),
    });

    const { user } = renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={INITIAL_MANIFEST}
      />,
    );

    await user.click(screen.getByRole('button', { name: /verify against head/i }));

    await waitFor(() => {
      expect(screen.getByText('FAIL')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('SAVE is enabled when ALLOW UNVERIFIED SAVE is toggled on', async () => {
    const { user } = renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={INITIAL_MANIFEST}
      />,
    );

    const toggle = screen.getByRole('checkbox', { name: /allow unverified save/i });
    await user.click(toggle);

    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
  });

  it('SAVE calls updateGateManifest without verify option', async () => {
    mockUpdateGateManifest.mockResolvedValueOnce({ persisted: true });

    const { user } = renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={INITIAL_MANIFEST}
      />,
    );

    // Enable save via allow-unverified toggle
    await user.click(screen.getByRole('checkbox', { name: /allow unverified save/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdateGateManifest).toHaveBeenCalledWith(
        BATTLEFIELD_ID,
        INITIAL_MANIFEST,
      );
    });
  });

  it('AUTO-DETECT calls establishGates', async () => {
    mockEstablishGates.mockResolvedValueOnce(undefined);

    const { user } = renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: /auto-detect/i }));

    await waitFor(() => {
      expect(mockEstablishGates).toHaveBeenCalledWith(BATTLEFIELD_ID);
    });
  });

  it('shows per-gate FAIL status when verify fails', async () => {
    mockUpdateGateManifest.mockResolvedValueOnce({
      persisted: false,
      verifyResults: buildFailResults(),
    });

    const { user } = renderWithProviders(
      <GateManifestEditor
        battlefieldId={BATTLEFIELD_ID}
        initialManifest={INITIAL_MANIFEST}
      />,
    );

    await user.click(screen.getByRole('button', { name: /verify against head/i }));

    await waitFor(() => {
      expect(screen.getByText('FAIL')).toBeInTheDocument();
    });
  });
});
