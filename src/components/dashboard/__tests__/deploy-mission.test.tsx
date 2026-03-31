import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { DeployMission } from '../deploy-mission';

// --- Mock server actions ---
const mockCreateMission = vi.fn();
const mockCreateAndDeployMission = vi.fn();

vi.mock('@/actions/mission', () => ({
  createMission: (...args: unknown[]) => mockCreateMission(...args),
  createAndDeployMission: (...args: unknown[]) => mockCreateAndDeployMission(...args),
}));

const mockLinkNoteToMission = vi.fn();
vi.mock('@/actions/intel', () => ({
  linkNoteToMission: (...args: unknown[]) => mockLinkNoteToMission(...args),
}));

// --- Mock sonner toast ---
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// --- Mock DossierSelector ---
vi.mock('@/components/dashboard/dossier-selector', () => ({
  DossierSelector: () => <button type="button">DOSSIER</button>,
}));

// --- Mock TacTextareaWithImages as a simple textarea ---
vi.mock('@/components/ui/tac-textarea-with-images', () => ({
  TacTextareaWithImages: ({
    value,
    onChange,
    placeholder,
    disabled,
    rows,
  }: {
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    disabled?: boolean;
    rows?: number;
  }) => (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      data-testid="briefing-textarea"
    />
  ),
}));

const baseProps = {
  battlefieldId: 'bf-1',
  assets: [
    { id: 'a1', codename: 'ALPHA', status: 'active' },
    { id: 'a2', codename: 'BRAVO', status: 'active' },
    { id: 'a3', codename: 'CHARLIE', status: 'offline' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateMission.mockResolvedValue({ id: 'new-mission-1' });
  mockCreateAndDeployMission.mockResolvedValue({ id: 'new-mission-2' });
  mockLinkNoteToMission.mockResolvedValue(undefined);
});

describe('DeployMission', () => {
  describe('rendering', () => {
    it('renders DEPLOY MISSION header', () => {
      renderWithProviders(<DeployMission {...baseProps} />);
      expect(screen.getByText('DEPLOY MISSION')).toBeInTheDocument();
    });

    it('renders briefing textarea', () => {
      renderWithProviders(<DeployMission {...baseProps} />);
      expect(screen.getByTestId('briefing-textarea')).toBeInTheDocument();
    });

    it('renders asset selector with only active assets', () => {
      renderWithProviders(<DeployMission {...baseProps} />);

      const select = screen.getByRole('combobox');
      const options = Array.from(select.querySelectorAll('option'));
      const optionTexts = options.map((o) => o.textContent);

      expect(optionTexts).toContain('NO ASSET');
      expect(optionTexts).toContain('ALPHA');
      expect(optionTexts).toContain('BRAVO');
      expect(optionTexts).not.toContain('CHARLIE');
    });

    it('renders SAVE and SAVE & DEPLOY buttons', () => {
      renderWithProviders(<DeployMission {...baseProps} />);
      expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save & deploy/i })).toBeInTheDocument();
    });

    it('shows initial briefing when provided', () => {
      renderWithProviders(
        <DeployMission {...baseProps} initialBriefing="Pre-filled briefing" />,
      );
      expect(screen.getByTestId('briefing-textarea')).toHaveValue('Pre-filled briefing');
    });
  });

  describe('validation', () => {
    it('disables SAVE button when briefing is empty', () => {
      renderWithProviders(<DeployMission {...baseProps} />);
      expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    });

    it('disables SAVE & DEPLOY button when briefing is empty', () => {
      renderWithProviders(<DeployMission {...baseProps} />);
      expect(screen.getByRole('button', { name: /save & deploy/i })).toBeDisabled();
    });

    it('enables buttons when briefing has text', async () => {
      const { user } = renderWithProviders(<DeployMission {...baseProps} />);

      await user.type(screen.getByTestId('briefing-textarea'), 'A mission');

      expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /save & deploy/i })).not.toBeDisabled();
    });
  });

  describe('save action', () => {
    it('calls createMission with briefing and battlefieldId', async () => {
      const { user } = renderWithProviders(<DeployMission {...baseProps} />);

      await user.type(screen.getByTestId('briefing-textarea'), 'Build the API');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockCreateMission).toHaveBeenCalledWith({
          battlefieldId: 'bf-1',
          briefing: 'Build the API',
          assetId: undefined,
        });
      });
    });

    it('includes selected assetId', async () => {
      const { user } = renderWithProviders(<DeployMission {...baseProps} />);

      await user.type(screen.getByTestId('briefing-textarea'), 'Mission text');
      await user.selectOptions(screen.getByRole('combobox'), 'a1');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockCreateMission).toHaveBeenCalledWith({
          battlefieldId: 'bf-1',
          briefing: 'Mission text',
          assetId: 'a1',
        });
      });
    });

    it('links note when noteId is provided', async () => {
      const { user } = renderWithProviders(
        <DeployMission {...baseProps} noteId="note-1" />,
      );

      await user.type(screen.getByTestId('briefing-textarea'), 'Mission');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockLinkNoteToMission).toHaveBeenCalledWith('note-1', 'new-mission-1');
      });
    });

    it('resets form after successful save', async () => {
      const { user } = renderWithProviders(<DeployMission {...baseProps} />);

      await user.type(screen.getByTestId('briefing-textarea'), 'Mission text');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(screen.getByTestId('briefing-textarea')).toHaveValue('');
      });
    });
  });

  describe('save & deploy action', () => {
    it('calls createAndDeployMission', async () => {
      const { user } = renderWithProviders(<DeployMission {...baseProps} />);

      await user.type(screen.getByTestId('briefing-textarea'), 'Deploy now');
      await user.click(screen.getByRole('button', { name: /save & deploy/i }));

      await waitFor(() => {
        expect(mockCreateAndDeployMission).toHaveBeenCalledWith({
          battlefieldId: 'bf-1',
          briefing: 'Deploy now',
          assetId: undefined,
        });
      });
    });

    it('links note when noteId is provided', async () => {
      const { user } = renderWithProviders(
        <DeployMission {...baseProps} noteId="note-2" />,
      );

      await user.type(screen.getByTestId('briefing-textarea'), 'Deploy it');
      await user.click(screen.getByRole('button', { name: /save & deploy/i }));

      await waitFor(() => {
        expect(mockLinkNoteToMission).toHaveBeenCalledWith('note-2', 'new-mission-2');
      });
    });
  });

  describe('error handling', () => {
    it('shows error toast when createMission fails', async () => {
      const { toast } = await import('sonner');
      mockCreateMission.mockRejectedValue(new Error('DB error'));

      const { user } = renderWithProviders(<DeployMission {...baseProps} />);

      await user.type(screen.getByTestId('briefing-textarea'), 'Fail mission');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('DB error');
      });
    });

    it('shows error toast when createAndDeployMission fails', async () => {
      const { toast } = await import('sonner');
      mockCreateAndDeployMission.mockRejectedValue(new Error('Deploy error'));

      const { user } = renderWithProviders(<DeployMission {...baseProps} />);

      await user.type(screen.getByTestId('briefing-textarea'), 'Fail deploy');
      await user.click(screen.getByRole('button', { name: /save & deploy/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Deploy error');
      });
    });
  });
});
