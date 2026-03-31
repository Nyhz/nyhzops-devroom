// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { CreateBattlefield } from '../create-battlefield';

// Mock server actions
vi.mock('@/actions/battlefield', () => ({
  createBattlefield: vi.fn(),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock next/navigation — override the default from component-setup
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
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

// Suppress fetch calls (scaffold fire-and-forget)
globalThis.fetch = vi.fn(() => Promise.resolve(new Response())) as unknown as typeof fetch;

import { createBattlefield } from '@/actions/battlefield';
import { toast } from 'sonner';

const mockedCreateBattlefield = vi.mocked(createBattlefield);

describe('CreateBattlefield', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const devBasePath = '/Users/dev/projects';

  // --- Rendering ---

  it('renders the form with all fields in new mode', () => {
    renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    expect(screen.getByText('NAME')).toBeInTheDocument();
    expect(screen.getByText('CODENAME')).toBeInTheDocument();
    expect(screen.getByText('DESCRIPTION')).toBeInTheDocument();
    expect(screen.getByText('INITIAL BRIEFING')).toBeInTheDocument();
    expect(screen.getByText('SCAFFOLD COMMAND')).toBeInTheDocument();
    expect(screen.getByText('DEFAULT BRANCH')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CREATE BATTLEFIELD' })).toBeInTheDocument();
  });

  it('shows link mode toggle button', () => {
    renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    expect(screen.getByText('[Link existing repo]')).toBeInTheDocument();
  });

  it('switches to link mode and shows repo path field', async () => {
    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    await user.click(screen.getByText('[Link existing repo]'));

    expect(screen.getByText('REPO PATH')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('/absolute/path/to/existing/repo')).toBeInTheDocument();
    // New-project-only fields should be hidden
    expect(screen.queryByText('SCAFFOLD COMMAND')).not.toBeInTheDocument();
    expect(screen.queryByText('DEFAULT BRANCH')).not.toBeInTheDocument();
    // Toggle text changes
    expect(screen.getByText('[Create new project]')).toBeInTheDocument();
  });

  it('shows computed repo path in new mode', async () => {
    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    const nameInput = screen.getByPlaceholderText('Project name');
    await user.type(nameInput, 'My App');

    expect(screen.getByText(`${devBasePath}/my-app`)).toBeInTheDocument();
  });

  it('auto-generates codename from name', async () => {
    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    const nameInput = screen.getByPlaceholderText('Project name');
    await user.type(nameInput, 'test project');

    const codenameInput = screen.getByPlaceholderText('OPERATION THUNDER') as HTMLInputElement;
    expect(codenameInput.value).toBe('OPERATION TEST PROJECT');
  });

  it('stops auto-generating codename after manual edit', async () => {
    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    const codenameInput = screen.getByPlaceholderText('OPERATION THUNDER');
    await user.type(codenameInput, 'CUSTOM CODENAME');

    const nameInput = screen.getByPlaceholderText('Project name');
    await user.type(nameInput, 'something');

    expect((codenameInput as HTMLInputElement).value).toBe('CUSTOM CODENAME');
  });

  // --- Skip Bootstrap ---

  it('shows CLAUDE.md and SPEC.md path fields when skip bootstrap is toggled', async () => {
    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    await user.click(screen.getByText("Skip bootstrap — I'll provide my own CLAUDE.md"));

    expect(screen.getByText('CLAUDE.MD PATH')).toBeInTheDocument();
    expect(screen.getByText('SPEC.MD PATH')).toBeInTheDocument();
    expect(screen.queryByText('INITIAL BRIEFING')).not.toBeInTheDocument();
  });

  it('toggles back to initial briefing when skip bootstrap is undone', async () => {
    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    // Enable skip
    await user.click(screen.getByText("Skip bootstrap — I'll provide my own CLAUDE.md"));
    expect(screen.getByText('CLAUDE.MD PATH')).toBeInTheDocument();

    // Disable skip
    await user.click(screen.getByText('← Generate docs automatically'));
    expect(screen.getByText('INITIAL BRIEFING')).toBeInTheDocument();
    expect(screen.queryByText('CLAUDE.MD PATH')).not.toBeInTheDocument();
  });

  // --- Validation ---

  it('shows error when name is empty on submit', async () => {
    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    await user.click(screen.getByRole('button', { name: 'CREATE BATTLEFIELD' }));

    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    expect(mockedCreateBattlefield).not.toHaveBeenCalled();
  });

  it('shows error when repo path is empty in link mode', async () => {
    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    // Switch to link mode
    await user.click(screen.getByText('[Link existing repo]'));

    // Fill name but not repo path
    await user.type(screen.getByPlaceholderText('Project name'), 'Test');

    await user.click(screen.getByRole('button', { name: 'CREATE BATTLEFIELD' }));

    expect(screen.getByText('Repo path is required when linking an existing repository.')).toBeInTheDocument();
    expect(mockedCreateBattlefield).not.toHaveBeenCalled();
  });

  // --- Successful Submission ---

  it('calls createBattlefield and navigates on success', async () => {
    mockedCreateBattlefield.mockResolvedValueOnce({ id: 'bf-123' } as ReturnType<typeof createBattlefield> extends Promise<infer T> ? T : never);

    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    await user.type(screen.getByPlaceholderText('Project name'), 'Alpha');
    await user.click(screen.getByRole('button', { name: 'CREATE BATTLEFIELD' }));

    await waitFor(() => {
      expect(mockedCreateBattlefield).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Alpha',
          codename: 'OPERATION ALPHA',
          skipBootstrap: false,
        }),
      );
    });

    expect(toast.success).toHaveBeenCalledWith('Battlefield created');
    expect(mockPush).toHaveBeenCalledWith('/battlefields/bf-123');
  });

  it('passes scaffold command and default branch in new mode', async () => {
    mockedCreateBattlefield.mockResolvedValueOnce({ id: 'bf-456' } as ReturnType<typeof createBattlefield> extends Promise<infer T> ? T : never);

    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    await user.type(screen.getByPlaceholderText('Project name'), 'Bravo');
    await user.type(screen.getByPlaceholderText('e.g. npx create-next-app . --typescript'), 'npx create-next-app .');
    await user.clear(screen.getByPlaceholderText('main'));
    await user.type(screen.getByPlaceholderText('main'), 'develop');

    await user.click(screen.getByRole('button', { name: 'CREATE BATTLEFIELD' }));

    await waitFor(() => {
      expect(mockedCreateBattlefield).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bravo',
          scaffoldCommand: 'npx create-next-app .',
          defaultBranch: 'develop',
        }),
      );
    });
  });

  it('passes repoPath in link mode', async () => {
    mockedCreateBattlefield.mockResolvedValueOnce({ id: 'bf-789' } as ReturnType<typeof createBattlefield> extends Promise<infer T> ? T : never);

    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    await user.click(screen.getByText('[Link existing repo]'));
    await user.type(screen.getByPlaceholderText('/absolute/path/to/existing/repo'), '/home/dev/existing');
    await user.type(screen.getByPlaceholderText('Project name'), 'Charlie');

    await user.click(screen.getByRole('button', { name: 'CREATE BATTLEFIELD' }));

    await waitFor(() => {
      expect(mockedCreateBattlefield).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Charlie',
          repoPath: '/home/dev/existing',
        }),
      );
    });
  });

  it('passes skip bootstrap fields when enabled', async () => {
    mockedCreateBattlefield.mockResolvedValueOnce({ id: 'bf-skip' } as ReturnType<typeof createBattlefield> extends Promise<infer T> ? T : never);

    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    await user.type(screen.getByPlaceholderText('Project name'), 'Delta');
    await user.click(screen.getByText("Skip bootstrap — I'll provide my own CLAUDE.md"));
    await user.type(screen.getByPlaceholderText('Absolute path to CLAUDE.md'), '/path/to/CLAUDE.md');

    await user.click(screen.getByRole('button', { name: 'CREATE BATTLEFIELD' }));

    await waitFor(() => {
      expect(mockedCreateBattlefield).toHaveBeenCalledWith(
        expect.objectContaining({
          skipBootstrap: true,
          claudeMdPath: '/path/to/CLAUDE.md',
        }),
      );
    });
  });

  // --- Error Handling ---

  it('displays error and toast on createBattlefield failure', async () => {
    mockedCreateBattlefield.mockRejectedValueOnce(new Error('Directory already exists'));

    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    await user.type(screen.getByPlaceholderText('Project name'), 'Fail');
    await user.click(screen.getByRole('button', { name: 'CREATE BATTLEFIELD' }));

    await waitFor(() => {
      expect(screen.getByText('Directory already exists')).toBeInTheDocument();
    });

    expect(toast.error).toHaveBeenCalledWith('Directory already exists');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows DEPLOYING... text while submitting', async () => {
    // Never resolve to keep the submitting state
    mockedCreateBattlefield.mockReturnValueOnce(new Promise(() => {}));

    const { user } = renderWithProviders(<CreateBattlefield devBasePath={devBasePath} />);

    await user.type(screen.getByPlaceholderText('Project name'), 'Echo');
    await user.click(screen.getByRole('button', { name: 'CREATE BATTLEFIELD' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'DEPLOYING...' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'DEPLOYING...' })).toBeDisabled();
    });
  });
});
