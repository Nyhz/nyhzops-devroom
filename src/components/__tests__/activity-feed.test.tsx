import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import type { ActivityEvent } from '@/hooks/use-activity-feed';

// Mock the TacCard component
vi.mock('@/components/ui/tac-card', () => ({
  TacCard: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="tac-card" className={className}>{children}</div>
  ),
}));

// Mock the useActivityFeed hook
let mockEvents: ActivityEvent[] = [];
vi.mock('@/hooks/use-activity-feed', () => ({
  useActivityFeed: () => mockEvents,
}));

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

/** Format a timestamp the same way the component does (Europe/Madrid). */
function expectedTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

describe('ActivityFeed', () => {
  beforeEach(() => {
    mockEvents = [];
    vi.clearAllMocks();
  });

  it('renders empty state when no events', () => {
    render(<ActivityFeed />);
    expect(screen.getByText('No recent activity. Deploy a mission to begin.')).toBeInTheDocument();
  });

  it('renders ACTIVITY FEED header', () => {
    render(<ActivityFeed />);
    expect(screen.getByText('ACTIVITY FEED')).toBeInTheDocument();
  });

  it('renders activity items', () => {
    const ts = 1711929600000; // 2024-04-01 00:00:00 UTC
    mockEvents = [
      {
        type: 'mission:deploying',
        battlefieldCodename: 'ALPHA',
        missionTitle: 'Test Mission',
        timestamp: ts,
        detail: 'Starting deployment',
      },
    ];

    render(<ActivityFeed />);
    expect(screen.getByText('ALPHA')).toBeInTheDocument();
    expect(screen.getByText('Test Mission')).toBeInTheDocument();
    expect(screen.getByText('Starting deployment')).toBeInTheDocument();
    expect(screen.getByText(expectedTime(ts))).toBeInTheDocument();
  });

  it('renders multiple activity items', () => {
    mockEvents = [
      {
        type: 'mission:deploying',
        battlefieldCodename: 'ALPHA',
        missionTitle: 'Mission 1',
        timestamp: 1711929600000,
        detail: '',
      },
      {
        type: 'mission:accomplished',
        battlefieldCodename: 'BRAVO',
        missionTitle: 'Mission 2',
        timestamp: 1711929660000,
        detail: '',
      },
    ];

    render(<ActivityFeed />);
    expect(screen.getByText('ALPHA')).toBeInTheDocument();
    expect(screen.getByText('BRAVO')).toBeInTheDocument();
    expect(screen.getByText('Mission 1')).toBeInTheDocument();
    expect(screen.getByText('Mission 2')).toBeInTheDocument();
  });

  it('renders correct type indicator for deploying', () => {
    mockEvents = [
      {
        type: 'mission:deploying',
        battlefieldCodename: 'ALPHA',
        missionTitle: 'Test',
        timestamp: 1711929600000,
        detail: '',
      },
    ];

    render(<ActivityFeed />);
    // Deploying uses ◈ symbol
    expect(screen.getByText('\u25C8')).toBeInTheDocument();
  });

  it('renders correct type indicator for accomplished', () => {
    mockEvents = [
      {
        type: 'mission:accomplished',
        battlefieldCodename: 'ALPHA',
        missionTitle: 'Test',
        timestamp: 1711929600000,
        detail: '',
      },
    ];

    render(<ActivityFeed />);
    // Accomplished uses ★ symbol
    expect(screen.getByText('\u2605')).toBeInTheDocument();
  });

  it('renders correct type indicator for compromised', () => {
    mockEvents = [
      {
        type: 'mission:compromised',
        battlefieldCodename: 'ALPHA',
        missionTitle: 'Test',
        timestamp: 1711929600000,
        detail: '',
      },
    ];

    render(<ActivityFeed />);
    // Compromised uses ✖ symbol
    expect(screen.getByText('\u2716')).toBeInTheDocument();
  });

  it('does not render detail span when detail is empty', () => {
    mockEvents = [
      {
        type: 'created',
        battlefieldCodename: 'ALPHA',
        missionTitle: 'Test',
        timestamp: 1711929600000,
        detail: '',
      },
    ];

    const { container } = render(<ActivityFeed />);
    // The span with text-dr-muted should not be rendered for empty detail
    const mutedSpans = container.querySelectorAll('.text-dr-muted.truncate');
    expect(mutedSpans).toHaveLength(0);
  });

  it('accepts className prop', () => {
    const { container } = render(<ActivityFeed className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('formats timestamps in Europe/Madrid timezone', () => {
    // 2024-04-01 14:30:45 UTC
    const ts = new Date('2024-04-01T14:30:45Z').getTime();
    mockEvents = [
      {
        type: 'created',
        battlefieldCodename: 'ALPHA',
        missionTitle: 'Test',
        timestamp: ts,
        detail: '',
      },
    ];

    render(<ActivityFeed />);
    expect(screen.getByText(expectedTime(ts))).toBeInTheDocument();
  });
});
