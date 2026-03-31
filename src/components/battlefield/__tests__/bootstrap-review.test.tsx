import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { BootstrapReview } from '../bootstrap-review';

// Mock server actions
vi.mock('@/actions/battlefield', () => ({
  approveBootstrap: vi.fn(),
  regenerateBootstrap: vi.fn(),
  abandonBootstrap: vi.fn(),
  writeBootstrapFile: vi.fn(),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock next/navigation
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

// Mock useConfirm — immediately resolves with action index 0 (confirm)
let confirmResolveValue = 0;
vi.mock('@/hooks/use-confirm', () => ({
  useConfirm: () => {
    const confirm = vi.fn(() => Promise.resolve(confirmResolveValue));
    const ConfirmDialog = () => null;
    return [confirm, ConfirmDialog];
  },
}));

// Mock Markdown to render plain text
vi.mock('@/components/ui/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

// Mock ScrollArea to pass through children
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import {
  approveBootstrap,
  regenerateBootstrap,
  abandonBootstrap,
  writeBootstrapFile,
} from '@/actions/battlefield';
import { toast } from 'sonner';

const mockedApprove = vi.mocked(approveBootstrap);
const mockedRegenerate = vi.mocked(regenerateBootstrap);
const mockedAbandon = vi.mocked(abandonBootstrap);
const mockedWriteFile = vi.mocked(writeBootstrapFile);

const defaultProps = {
  battlefieldId: 'bf-001',
  codename: 'OPERATION THUNDER',
  initialBriefing: 'Build a web app',
  initialClaudeMd: '# CLAUDE.md content',
  initialSpecMd: '# SPEC.md content',
};

describe('BootstrapReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmResolveValue = 0;
  });

  // --- Rendering ---

  it('renders header with codename', () => {
    renderWithProviders(<BootstrapReview {...defaultProps} />);

    expect(screen.getByText('OPERATION THUNDER — BOOTSTRAP COMPLETE')).toBeInTheDocument();
    expect(screen.getByText('Status: INITIALIZING — Awaiting Commander review')).toBeInTheDocument();
  });

  it('renders CLAUDE.md and SPEC.md content', () => {
    renderWithProviders(<BootstrapReview {...defaultProps} />);

    const markdowns = screen.getAllByTestId('markdown');
    expect(markdowns[0]).toHaveTextContent('# CLAUDE.md content');
    expect(markdowns[1]).toHaveTextContent('# SPEC.md content');
  });

  it('renders CLAUDE.md and SPEC.md labels', () => {
    renderWithProviders(<BootstrapReview {...defaultProps} />);

    expect(screen.getByText('CLAUDE.md')).toBeInTheDocument();
    expect(screen.getByText('SPEC.md')).toBeInTheDocument();
  });

  it('renders action buttons', () => {
    renderWithProviders(<BootstrapReview {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'APPROVE & DEPLOY' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'REGENERATE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ABANDON' })).toBeInTheDocument();
  });

  it('renders EDIT buttons for both documents', () => {
    renderWithProviders(<BootstrapReview {...defaultProps} />);

    const editButtons = screen.getAllByRole('button', { name: 'EDIT' });
    expect(editButtons).toHaveLength(2);
  });

  // --- Approve ---

  it('calls approveBootstrap and navigates on approve', async () => {
    mockedApprove.mockResolvedValueOnce(undefined);

    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'APPROVE & DEPLOY' }));

    await waitFor(() => {
      expect(mockedApprove).toHaveBeenCalledWith('bf-001');
    });

    expect(toast.success).toHaveBeenCalledWith('Bootstrap approved — Battlefield active');
    expect(mockPush).toHaveBeenCalledWith('/battlefields/bf-001');
  });

  it('shows error toast when approve fails', async () => {
    mockedApprove.mockRejectedValueOnce(new Error('Approval failed'));

    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'APPROVE & DEPLOY' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Approval failed');
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  // --- Regenerate ---

  it('shows regenerate section when REGENERATE is clicked', async () => {
    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'REGENERATE' }));

    expect(screen.getByText('REGENERATE — Edit Briefing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CONFIRM REGENERATE' })).toBeInTheDocument();
  });

  it('calls regenerateBootstrap with briefing text', async () => {
    mockedRegenerate.mockResolvedValueOnce(undefined);

    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    // Open regenerate section
    await user.click(screen.getByRole('button', { name: 'REGENERATE' }));

    // Click confirm
    await user.click(screen.getByRole('button', { name: 'CONFIRM REGENERATE' }));

    await waitFor(() => {
      expect(mockedRegenerate).toHaveBeenCalledWith('bf-001', 'Build a web app');
    });

    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows error toast when regenerate fails', async () => {
    mockedRegenerate.mockRejectedValueOnce(new Error('Regen failed'));

    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'REGENERATE' }));
    await user.click(screen.getByRole('button', { name: 'CONFIRM REGENERATE' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Regen failed');
    });
  });

  // --- Abandon ---

  it('calls abandonBootstrap and navigates to home on confirm', async () => {
    mockedAbandon.mockResolvedValueOnce(undefined);

    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'ABANDON' }));

    await waitFor(() => {
      expect(mockedAbandon).toHaveBeenCalledWith('bf-001');
    });

    expect(toast.success).toHaveBeenCalledWith('Bootstrap abandoned');
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('does not call abandonBootstrap when confirm is cancelled', async () => {
    confirmResolveValue = -1; // Simulate cancel

    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'ABANDON' }));

    // Wait a tick to ensure the async function completes
    await waitFor(() => {
      expect(mockedAbandon).not.toHaveBeenCalled();
    });
  });

  it('shows error toast when abandon fails', async () => {
    mockedAbandon.mockRejectedValueOnce(new Error('Abandon failed'));

    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'ABANDON' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Abandon failed');
    });

    expect(mockPush).not.toHaveBeenCalledWith('/');
  });

  // --- Edit Documents ---

  it('enters edit mode for CLAUDE.md and shows textarea with content', async () => {
    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    const editButtons = screen.getAllByRole('button', { name: 'EDIT' });
    await user.click(editButtons[0]); // First EDIT = CLAUDE.md

    expect(screen.getByText('◆ EDITING — CLAUDE.md')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SAVE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeInTheDocument();

    const textarea = screen.getByDisplayValue('# CLAUDE.md content');
    expect(textarea).toBeInTheDocument();
  });

  it('saves edited content via writeBootstrapFile', async () => {
    mockedWriteFile.mockResolvedValueOnce(undefined);

    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    // Enter edit mode for CLAUDE.md
    const editButtons = screen.getAllByRole('button', { name: 'EDIT' });
    await user.click(editButtons[0]);

    // Modify content
    const textarea = screen.getByDisplayValue('# CLAUDE.md content');
    await user.clear(textarea);
    await user.type(textarea, '# Updated CLAUDE');

    // Save
    await user.click(screen.getByRole('button', { name: 'SAVE' }));

    await waitFor(() => {
      expect(mockedWriteFile).toHaveBeenCalledWith('bf-001', 'CLAUDE.md', '# Updated CLAUDE');
    });

    expect(toast.success).toHaveBeenCalledWith('CLAUDE.md saved');
  });

  it('cancels edit mode without saving', async () => {
    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    // Enter edit mode
    const editButtons = screen.getAllByRole('button', { name: 'EDIT' });
    await user.click(editButtons[0]);

    expect(screen.getByText('◆ EDITING — CLAUDE.md')).toBeInTheDocument();

    // Cancel
    await user.click(screen.getByRole('button', { name: 'CANCEL' }));

    // Should be back to view mode
    expect(screen.queryByText('◆ EDITING — CLAUDE.md')).not.toBeInTheDocument();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('shows error toast when save fails', async () => {
    mockedWriteFile.mockRejectedValueOnce(new Error('Write failed'));

    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    const editButtons = screen.getAllByRole('button', { name: 'EDIT' });
    await user.click(editButtons[0]);

    await user.click(screen.getByRole('button', { name: 'SAVE' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Write failed');
    });
  });

  // --- Button disabled states ---

  it('disables action buttons while editing', async () => {
    const { user } = renderWithProviders(<BootstrapReview {...defaultProps} />);

    const editButtons = screen.getAllByRole('button', { name: 'EDIT' });
    await user.click(editButtons[0]);

    expect(screen.getByRole('button', { name: 'APPROVE & DEPLOY' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'REGENERATE' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ABANDON' })).toBeDisabled();
  });
});
