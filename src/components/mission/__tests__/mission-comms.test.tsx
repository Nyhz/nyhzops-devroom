import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { MissionComms } from '../mission-comms';
import type { MissionLog, MissionStatus } from '@/types';

// --- Mock useMissionComms hook ---
const mockUseMissionComms = vi.fn();

vi.mock('@/hooks/use-mission-comms', () => ({
  useMissionComms: (...args: unknown[]) => mockUseMissionComms(...args),
}));

// --- Mock next/navigation ---
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

// --- Mock Markdown to avoid react-markdown jsdom issues ---
vi.mock('@/components/ui/markdown', () => ({
  Markdown: ({ content, className }: { content: string; className?: string }) => (
    <div className={className} data-testid="markdown">{content}</div>
  ),
}));

// --- Mock MissionActions ---
vi.mock('@/components/mission/mission-actions', () => ({
  MissionActions: (props: Record<string, unknown>) => (
    <div data-testid="mission-actions" data-status={props.status} />
  ),
}));

// --- Mock react-tooltip ---
vi.mock('react-tooltip', () => ({
  Tooltip: () => null,
}));

const baseLogs: MissionLog[] = [
  { id: 'log-1', missionId: 'm-1', timestamp: 1000, type: 'log', content: 'Starting analysis...' },
  { id: 'log-2', missionId: 'm-1', timestamp: 2000, type: 'status', content: 'Connected to agent' },
];

const baseProps = {
  missionId: 'm-1',
  initialLogs: baseLogs,
  initialStatus: 'in_combat' as string,
  initialDebrief: null as string | null,
  initialTokens: { input: 100, output: 50, cacheHit: 20, duration: 5000 },
  battlefieldId: 'bf-1',
  initialSessionId: null as string | null,
  campaignId: null as string | null,
  briefing: undefined as string | undefined,
  worktreeBranch: null as string | null,
};

function setupHookReturn(overrides: Partial<ReturnType<typeof mockUseMissionComms>> = {}) {
  const defaults = {
    logs: baseLogs,
    status: null as MissionStatus | null,
    debrief: null as string | null,
    tokens: null,
  };
  mockUseMissionComms.mockReturnValue({ ...defaults, ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupHookReturn();
});

describe('MissionComms', () => {
  it('renders COMMS heading', () => {
    renderWithProviders(<MissionComms {...baseProps} />);
    expect(screen.getByText('COMMS')).toBeInTheDocument();
  });

  it('renders log lines in the terminal', () => {
    renderWithProviders(<MissionComms {...baseProps} />);
    expect(screen.getByText(/Starting analysis/)).toBeInTheDocument();
    expect(screen.getByText(/Connected to agent/)).toBeInTheDocument();
  });

  it('shows pre-deploy message when status is standby', () => {
    setupHookReturn({ status: 'standby' as MissionStatus });
    renderWithProviders(
      <MissionComms {...baseProps} initialStatus="standby" />,
    );
    expect(
      screen.getByText(/Awaiting deployment/),
    ).toBeInTheDocument();
  });

  it('shows pre-deploy message when status is queued', () => {
    setupHookReturn({ status: 'queued' as MissionStatus });
    renderWithProviders(
      <MissionComms {...baseProps} initialStatus="queued" />,
    );
    expect(
      screen.getByText(/Awaiting deployment/),
    ).toBeInTheDocument();
  });

  it('does not show debrief section when no debrief', () => {
    renderWithProviders(<MissionComms {...baseProps} />);
    expect(screen.queryByText('DEBRIEF')).not.toBeInTheDocument();
    expect(screen.queryByText('SITUATION REPORT')).not.toBeInTheDocument();
  });

  it('shows DEBRIEF heading when mission is accomplished with debrief', () => {
    setupHookReturn({
      status: 'accomplished' as MissionStatus,
      debrief: '## Mission complete\n\nAll objectives met.',
    });
    renderWithProviders(
      <MissionComms {...baseProps} initialStatus="accomplished" />,
    );
    expect(screen.getByText('DEBRIEF')).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveTextContent('## Mission complete');
  });

  it('shows SITUATION REPORT heading when mission is compromised', () => {
    setupHookReturn({
      status: 'compromised' as MissionStatus,
      debrief: 'Failed due to timeout.',
    });
    renderWithProviders(
      <MissionComms {...baseProps} initialStatus="compromised" />,
    );
    expect(screen.getByText('SITUATION REPORT')).toBeInTheDocument();
    expect(screen.queryByText('DEBRIEF')).not.toBeInTheDocument();
  });

  it('uses initialDebrief as fallback when hook returns null debrief', () => {
    setupHookReturn({ status: 'accomplished' as MissionStatus, debrief: null });
    renderWithProviders(
      <MissionComms
        {...baseProps}
        initialStatus="accomplished"
        initialDebrief="Initial debrief content"
      />,
    );
    expect(screen.getByTestId('markdown')).toHaveTextContent('Initial debrief content');
  });

  it('prefers live debrief over initialDebrief', () => {
    setupHookReturn({
      status: 'accomplished' as MissionStatus,
      debrief: 'Live debrief content',
    });
    renderWithProviders(
      <MissionComms
        {...baseProps}
        initialStatus="accomplished"
        initialDebrief="Initial debrief content"
      />,
    );
    expect(screen.getByTestId('markdown')).toHaveTextContent('Live debrief content');
  });

  it('appends "Debrief submitted" status line when terminal with debrief', () => {
    setupHookReturn({
      status: 'accomplished' as MissionStatus,
      debrief: 'Final report.',
    });
    renderWithProviders(
      <MissionComms {...baseProps} initialStatus="accomplished" />,
    );
    expect(screen.getByText(/Debrief submitted/)).toBeInTheDocument();
  });

  it('shows reviewing message when status is reviewing', () => {
    setupHookReturn({ status: 'reviewing' as MissionStatus });
    renderWithProviders(
      <MissionComms {...baseProps} initialStatus="reviewing" />,
    );
    expect(screen.getByText(/Overseer reviewing debrief/)).toBeInTheDocument();
  });

  it('calls router.refresh when mission reaches terminal status', () => {
    setupHookReturn({ status: 'accomplished' as MissionStatus });
    renderWithProviders(
      <MissionComms {...baseProps} initialStatus="accomplished" />,
    );
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it('does not call router.refresh for non-terminal statuses', () => {
    setupHookReturn({ status: 'in_combat' as MissionStatus });
    renderWithProviders(
      <MissionComms {...baseProps} initialStatus="in_combat" />,
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('passes correct props to MissionActions', () => {
    setupHookReturn({ status: 'in_combat' as MissionStatus });
    renderWithProviders(
      <MissionComms
        {...baseProps}
        initialSessionId="session-1"
        campaignId="campaign-1"
        briefing="Test briefing"
        worktreeBranch="feature/test"
      />,
    );
    const actions = screen.getByTestId('mission-actions');
    expect(actions).toHaveAttribute('data-status', 'in_combat');
  });

  it('passes useMissionComms the correct arguments', () => {
    renderWithProviders(<MissionComms {...baseProps} />);
    expect(mockUseMissionComms).toHaveBeenCalledWith(
      'm-1',
      baseLogs,
      'in_combat',
    );
  });

  it('filters debrief content from terminal logs when matching', () => {
    const debriefText = 'This is the full debrief content that should be filtered from logs.';
    const logsWithDebrief: MissionLog[] = [
      { id: 'log-1', missionId: 'm-1', timestamp: 1000, type: 'status', content: 'Starting...' },
      { id: 'log-2', missionId: 'm-1', timestamp: 2000, type: 'log', content: debriefText },
    ];
    setupHookReturn({
      logs: logsWithDebrief,
      status: 'accomplished' as MissionStatus,
      debrief: debriefText,
    });
    renderWithProviders(
      <MissionComms {...baseProps} initialStatus="accomplished" />,
    );
    // The debrief log line should be filtered from terminal
    // The debrief content should only appear in the markdown section
    const markdownEl = screen.getByTestId('markdown');
    expect(markdownEl).toHaveTextContent(debriefText);
    // "Starting..." status line should still be present
    expect(screen.getByText(/Starting\.\.\./)).toBeInTheDocument();
  });
});
