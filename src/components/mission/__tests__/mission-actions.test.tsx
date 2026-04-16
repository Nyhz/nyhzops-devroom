import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { MissionActions } from '../mission-actions';

// --- Mock server actions from @/actions/mission ---
const mockDeployMission = vi.fn();
const mockAbandonMission = vi.fn();
const mockContinueMission = vi.fn();
const mockTacticalOverride = vi.fn();
const mockAcceptMergeOverride = vi.fn();
const mockAnswerEscalation = vi.fn();

vi.mock('@/actions/mission', () => ({
  deployMission: (...args: unknown[]) => mockDeployMission(...args),
  abandonMission: (...args: unknown[]) => mockAbandonMission(...args),
  continueMission: (...args: unknown[]) => mockContinueMission(...args),
  tacticalOverride: (...args: unknown[]) => mockTacticalOverride(...args),
  acceptMergeOverride: (...args: unknown[]) => mockAcceptMergeOverride(...args),
  answerEscalation: (...args: unknown[]) => mockAnswerEscalation(...args),
}));

const mockSkipMission = vi.fn();

vi.mock('@/actions/campaign-overrides', () => ({
  skipMission: (...args: unknown[]) => mockSkipMission(...args),
}));

// --- Mock sonner toast ---
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// --- Mock react-tooltip (used by tacTooltip) ---
vi.mock('react-tooltip', () => ({
  Tooltip: () => null,
}));

const baseProps = {
  missionId: 'mission-1',
  battlefieldId: 'bf-1',
  sessionId: null as string | null,
  status: 'standby',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDeployMission.mockResolvedValue(undefined);
  mockAbandonMission.mockResolvedValue(undefined);
  mockContinueMission.mockResolvedValue({ id: 'new-mission-1' });
  mockTacticalOverride.mockResolvedValue(undefined);
  mockAcceptMergeOverride.mockResolvedValue(undefined);
  mockAnswerEscalation.mockResolvedValue(undefined);
  mockSkipMission.mockResolvedValue(undefined);
});

describe('MissionActions', () => {
  describe('button visibility by status', () => {
    it('shows DEPLOY and ABANDON for standby status', () => {
      renderWithProviders(<MissionActions {...baseProps} status="standby" />);
      expect(screen.getByRole('button', { name: /deploy/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /abandon/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /continue mission/i })).not.toBeInTheDocument();
    });

    it('shows ABANDON for in_combat status', () => {
      renderWithProviders(<MissionActions {...baseProps} status="in_combat" />);
      expect(screen.queryByRole('button', { name: /deploy/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /abandon/i })).toBeInTheDocument();
    });

    it('shows ABANDON for queued status', () => {
      renderWithProviders(<MissionActions {...baseProps} status="queued" />);
      expect(screen.queryByRole('button', { name: /deploy/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /abandon/i })).toBeInTheDocument();
    });

    it('shows ABANDON for deploying status', () => {
      renderWithProviders(<MissionActions {...baseProps} status="deploying" />);
      expect(screen.getByRole('button', { name: /abandon/i })).toBeInTheDocument();
    });

    it('shows CONTINUE MISSION for accomplished with sessionId', () => {
      renderWithProviders(
        <MissionActions {...baseProps} status="accomplished" sessionId="session-1" />,
      );
      expect(screen.getByRole('button', { name: /continue mission/i })).toBeInTheDocument();
    });

    it('does not show CONTINUE MISSION for accomplished without sessionId', () => {
      renderWithProviders(
        <MissionActions {...baseProps} status="accomplished" sessionId={null} />,
      );
      expect(screen.queryByRole('button', { name: /continue mission/i })).not.toBeInTheDocument();
    });

    it('shows TACTICAL OVERRIDE for compromised status', () => {
      renderWithProviders(
        <MissionActions {...baseProps} status="compromised" sessionId="s1" />,
      );
      expect(screen.getByRole('button', { name: /tactical override/i })).toBeInTheDocument();
    });

    it('shows TACTICAL OVERRIDE for abandoned status', () => {
      renderWithProviders(
        <MissionActions {...baseProps} status="abandoned" />,
      );
      expect(screen.getByRole('button', { name: /tactical override/i })).toBeInTheDocument();
    });

    it('shows ACCEPT & MERGE for compromised status', () => {
      renderWithProviders(
        <MissionActions {...baseProps} status="compromised" />,
      );
      expect(screen.getByRole('button', { name: /accept & merge/i })).toBeInTheDocument();
    });

    it('does not show ACCEPT & MERGE for non-compromised status', () => {
      renderWithProviders(
        <MissionActions {...baseProps} status="accomplished" />,
      );
      expect(screen.queryByRole('button', { name: /accept & merge/i })).not.toBeInTheDocument();
    });

    it('shows SKIP MISSION for compromised with campaignId', () => {
      renderWithProviders(
        <MissionActions {...baseProps} status="compromised" campaignId="camp-1" />,
      );
      expect(screen.getByRole('button', { name: /skip mission/i })).toBeInTheDocument();
    });

    it('does not show SKIP MISSION for compromised without campaignId', () => {
      renderWithProviders(
        <MissionActions {...baseProps} status="compromised" />,
      );
      expect(screen.queryByRole('button', { name: /skip mission/i })).not.toBeInTheDocument();
    });

    it('shows no action buttons for accomplished without sessionId', () => {
      renderWithProviders(
        <MissionActions {...baseProps} status="accomplished" sessionId={null} />,
      );
      expect(screen.queryByRole('button', { name: /deploy/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /abandon/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /continue mission/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /tactical override/i })).not.toBeInTheDocument();
    });

    it('does not show ABANDON for reviewing (legacy) status', () => {
      // 'reviewing' is a legacy status — not in the new canAbandon set
      renderWithProviders(
        <MissionActions {...baseProps} status="reviewing" />,
      );
      expect(screen.queryByRole('button', { name: /abandon/i })).not.toBeInTheDocument();
    });
  });

  describe('escalation answer panel', () => {
    it('shows escalation panel when compromised with escalated reason and question', () => {
      renderWithProviders(
        <MissionActions
          {...baseProps}
          status="compromised"
          compromiseReason="escalated"
          escalationQuestion="What should I do about the failing tests?"
        />,
      );
      expect(screen.getByText(/OVERSEER ESCALATION/i)).toBeInTheDocument();
      expect(screen.getByText(/What should I do about the failing tests/i)).toBeInTheDocument();
    });

    it('does not show escalation panel when compromiseReason is not escalated', () => {
      renderWithProviders(
        <MissionActions
          {...baseProps}
          status="compromised"
          compromiseReason="timeout"
          escalationQuestion="Some question"
        />,
      );
      expect(screen.queryByText(/OVERSEER ESCALATION/i)).not.toBeInTheDocument();
    });

    it('calls answerEscalation when answer is submitted', async () => {
      const { user } = renderWithProviders(
        <MissionActions
          {...baseProps}
          status="compromised"
          compromiseReason="escalated"
          escalationQuestion="What approach should I use?"
        />,
      );

      const textarea = screen.getByPlaceholderText(/Your answer to the Overseer/i);
      await user.type(textarea, 'Use approach A');

      await user.click(screen.getByRole('button', { name: /submit answer/i }));

      await waitFor(() => {
        expect(mockAnswerEscalation).toHaveBeenCalledWith('mission-1', 'Use approach A');
      });
    });

    it('hides escalation panel optimistically after successful submit', async () => {
      const { user } = renderWithProviders(
        <MissionActions
          {...baseProps}
          status="compromised"
          compromiseReason="escalated"
          escalationQuestion="What approach should I use?"
        />,
      );

      const textarea = screen.getByPlaceholderText(/Your answer to the Overseer/i);
      await user.type(textarea, 'Use approach A');
      await user.click(screen.getByRole('button', { name: /submit answer/i }));

      await waitFor(() => {
        expect(mockAnswerEscalation).toHaveBeenCalled();
      });

      // Panel should be hidden after successful submission
      await waitFor(() => {
        expect(screen.queryByText(/OVERSEER ESCALATION/i)).not.toBeInTheDocument();
      });
    });

    it('does not re-submit if button is clicked again before response', async () => {
      let resolveFirst: () => void;
      mockAnswerEscalation.mockImplementation(
        () => new Promise<void>((r) => { resolveFirst = r; }),
      );

      const { user } = renderWithProviders(
        <MissionActions
          {...baseProps}
          status="compromised"
          compromiseReason="escalated"
          escalationQuestion="Question here?"
        />,
      );

      const textarea = screen.getByPlaceholderText(/Your answer to the Overseer/i);
      await user.type(textarea, 'My answer');

      await user.click(screen.getByRole('button', { name: /submit answer/i }));

      // Panel should be gone already (optimistic hide)
      await waitFor(() => {
        expect(screen.queryByText(/OVERSEER ESCALATION/i)).not.toBeInTheDocument();
      });

      // Resolve to let the async call finish
      await act(async () => { resolveFirst!(); });

      expect(mockAnswerEscalation).toHaveBeenCalledTimes(1);
    });

    it('disables SUBMIT ANSWER button when answer is empty', () => {
      renderWithProviders(
        <MissionActions
          {...baseProps}
          status="compromised"
          compromiseReason="escalated"
          escalationQuestion="Some question"
        />,
      );
      const submitButton = screen.getByRole('button', { name: /submit answer/i });
      expect(submitButton).toBeDisabled();
    });
  });

  describe('deploy action', () => {
    it('calls deployMission when DEPLOY is clicked', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="standby" />,
      );

      await user.click(screen.getByRole('button', { name: /deploy/i }));

      await waitFor(() => {
        expect(mockDeployMission).toHaveBeenCalledWith('mission-1');
      });
    });

    it('shows DEPLOYING... while pending', async () => {
      let resolvePromise: () => void;
      mockDeployMission.mockImplementation(
        () => new Promise<void>((r) => { resolvePromise = r; }),
      );

      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="standby" />,
      );

      await user.click(screen.getByRole('button', { name: /^deploy$/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deploying/i })).toBeInTheDocument();
      });

      await act(async () => { resolvePromise!(); });
    });
  });

  describe('abandon action', () => {
    it('shows confirmation dialog when ABANDON is clicked', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="standby" />,
      );

      await user.click(screen.getByRole('button', { name: /abandon/i }));

      await waitFor(() => {
        expect(screen.getByText('CONFIRM ABANDON')).toBeInTheDocument();
      });
    });

    it('calls abandonMission when ABANDON is confirmed', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="standby" />,
      );

      await user.click(screen.getByRole('button', { name: /^abandon$/i }));

      await waitFor(() => {
        expect(screen.getByText('CONFIRM ABANDON')).toBeInTheDocument();
      });

      // Click the ABANDON action in the dialog
      const dialogButtons = screen.getAllByRole('button', { name: /^abandon$/i });
      const confirmButton = dialogButtons.find((btn) => btn.closest('[role="dialog"]'));
      expect(confirmButton).toBeDefined();
      await user.click(confirmButton!);

      await waitFor(() => {
        expect(mockAbandonMission).toHaveBeenCalledWith('mission-1');
      });
    });
  });

  describe('continue mission', () => {
    it('shows briefing textarea when CONTINUE MISSION is clicked', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="accomplished" sessionId="s1" />,
      );

      await user.click(screen.getByRole('button', { name: /continue mission/i }));

      expect(screen.getByPlaceholderText(/describe what to do next/i)).toBeInTheDocument();
    });

    it('calls continueMission with briefing text', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="accomplished" sessionId="s1" />,
      );

      await user.click(screen.getByRole('button', { name: /continue mission/i }));

      const textarea = screen.getByPlaceholderText(/describe what to do next/i);
      await user.type(textarea, 'Follow up instructions');

      await user.click(screen.getByRole('button', { name: /^deploy$/i }));

      await waitFor(() => {
        expect(mockContinueMission).toHaveBeenCalledWith('mission-1', 'Follow up instructions');
      });
    });

    it('disables deploy button when briefing is empty', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="accomplished" sessionId="s1" />,
      );

      await user.click(screen.getByRole('button', { name: /continue mission/i }));

      const deployButton = screen.getByRole('button', { name: /^deploy$/i });
      expect(deployButton).toBeDisabled();
    });

    it('hides continue form when CANCEL is clicked', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="accomplished" sessionId="s1" />,
      );

      await user.click(screen.getByRole('button', { name: /continue mission/i }));
      expect(screen.getByPlaceholderText(/describe what to do next/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(screen.queryByPlaceholderText(/describe what to do next/i)).not.toBeInTheDocument();
    });
  });

  describe('tactical override', () => {
    it('shows override form with pre-filled briefing', async () => {
      const { user } = renderWithProviders(
        <MissionActions
          {...baseProps}
          status="compromised"
          briefing="Original briefing"
        />,
      );

      await user.click(screen.getByRole('button', { name: /tactical override/i }));

      const textarea = screen.getByDisplayValue('Original briefing');
      expect(textarea).toBeInTheDocument();
    });

    it('calls tacticalOverride with edited briefing', async () => {
      const { user } = renderWithProviders(
        <MissionActions
          {...baseProps}
          status="compromised"
          briefing="Original"
        />,
      );

      await user.click(screen.getByRole('button', { name: /tactical override/i }));

      const textarea = screen.getByDisplayValue('Original');
      await user.clear(textarea);
      await user.type(textarea, 'Updated briefing');

      await user.click(screen.getByRole('button', { name: /deploy with override/i }));

      await waitFor(() => {
        expect(mockTacticalOverride).toHaveBeenCalledWith('mission-1', 'Updated briefing');
      });
    });
  });

  describe('accept & merge', () => {
    it('shows confirm dialog when ACCEPT & MERGE is clicked', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="compromised" />,
      );

      await user.click(screen.getByRole('button', { name: /accept & merge/i }));

      await waitFor(() => {
        // Dialog description text is shown
        expect(screen.getByText(/Force-merge this mission/i)).toBeInTheDocument();
      });
    });

    it('calls acceptMergeOverride when confirmed', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="compromised" />,
      );

      await user.click(screen.getByRole('button', { name: /^accept & merge$/i }));

      await waitFor(() => {
        expect(screen.getByText(/Force-merge this mission/i)).toBeInTheDocument();
      });

      // After dialog opens, there are multiple "ACCEPT & MERGE" buttons — click the last one (dialog action)
      const allButtons = screen.getAllByRole('button', { name: /^accept & merge$/i });
      await user.click(allButtons[allButtons.length - 1]);

      await waitFor(() => {
        expect(mockAcceptMergeOverride).toHaveBeenCalledWith('mission-1');
      });
    });
  });

  describe('skip mission', () => {
    it('shows confirm dialog when SKIP MISSION is clicked', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="compromised" campaignId="camp-1" />,
      );

      await user.click(screen.getByRole('button', { name: /skip mission/i }));

      await waitFor(() => {
        // Dialog shows description text
        expect(
          screen.getByText(/cascade-abandon any missions that depend on it/i),
        ).toBeInTheDocument();
      });
    });

    it('calls skipMission when confirmed', async () => {
      const { user } = renderWithProviders(
        <MissionActions {...baseProps} status="compromised" campaignId="camp-1" />,
      );

      await user.click(screen.getByRole('button', { name: /skip mission/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/cascade-abandon any missions that depend on it/i),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /^skip$/i }));

      await waitFor(() => {
        expect(mockSkipMission).toHaveBeenCalledWith('mission-1');
      });
    });
  });
});
