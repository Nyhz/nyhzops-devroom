import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import type { ActivityEvent } from '@/hooks/use-activity-feed';

const mockEvents: ActivityEvent[] = [];

vi.mock('@/hooks/use-activity-feed', () => ({
  useActivityFeed: () => mockEvents,
}));

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// TacCard uses cn() which needs to work, but no other dependencies
// Import after mocks are set up
const { ActivityFeed } = await import('../activity-feed');

function setEvents(events: ActivityEvent[]) {
  mockEvents.length = 0;
  mockEvents.push(...events);
}

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    type: overrides.type ?? 'created',
    battlefieldCodename: overrides.battlefieldCodename ?? 'ALPHA',
    missionTitle: overrides.missionTitle ?? 'Recon sweep',
    timestamp: overrides.timestamp ?? Date.UTC(2026, 2, 31, 14, 30, 0),
    detail: overrides.detail ?? '',
  };
}

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
  it('renders empty state when no events', () => {
    setEvents([]);
    renderWithProviders(<ActivityFeed />);

    expect(
      screen.getByText('No recent activity. Deploy a mission to begin.'),
    ).toBeInTheDocument();
  });

  it('renders the header', () => {
    setEvents([]);
    renderWithProviders(<ActivityFeed />);

    expect(screen.getByText('ACTIVITY FEED')).toBeInTheDocument();
  });

  it('renders event with battlefield codename and mission title', () => {
    setEvents([
      makeEvent({
        battlefieldCodename: 'BRAVO',
        missionTitle: 'Deploy auth module',
      }),
    ]);
    renderWithProviders(<ActivityFeed />);

    expect(screen.getByText('BRAVO')).toBeInTheDocument();
    expect(screen.getByText('Deploy auth module')).toBeInTheDocument();
  });

  it('renders formatted timestamp in Europe/Madrid timezone', () => {
    const ts = Date.UTC(2026, 2, 31, 9, 5, 7);
    setEvents([makeEvent({ timestamp: ts })]);
    renderWithProviders(<ActivityFeed />);

    expect(screen.getByText(expectedTime(ts))).toBeInTheDocument();
  });

  it('renders detail text when present', () => {
    setEvents([makeEvent({ detail: 'Phase 2 started' })]);
    renderWithProviders(<ActivityFeed />);

    expect(screen.getByText('Phase 2 started')).toBeInTheDocument();
  });

  it('does not render detail span when detail is empty', () => {
    setEvents([makeEvent({ detail: '' })]);
    const { container } = renderWithProviders(<ActivityFeed />);

    // 3 spans: timestamp, icon, codename, title — no detail
    const entry = container.querySelector('.flex.items-start');
    const spans = entry?.querySelectorAll('span');
    expect(spans).toHaveLength(4);
  });

  it('renders multiple events', () => {
    setEvents([
      makeEvent({ missionTitle: 'Mission A' }),
      makeEvent({ missionTitle: 'Mission B' }),
      makeEvent({ missionTitle: 'Mission C' }),
    ]);
    renderWithProviders(<ActivityFeed />);

    expect(screen.getByText('Mission A')).toBeInTheDocument();
    expect(screen.getByText('Mission B')).toBeInTheDocument();
    expect(screen.getByText('Mission C')).toBeInTheDocument();
  });

  it('shows star icon for accomplished events', () => {
    setEvents([makeEvent({ type: 'accomplished' })]);
    const { container } = renderWithProviders(<ActivityFeed />);

    const iconSpan = container.querySelector('.text-dr-green');
    expect(iconSpan).toBeInTheDocument();
    expect(iconSpan?.textContent).toBe('★');
  });

  it('shows cross icon for compromised events', () => {
    setEvents([makeEvent({ type: 'compromised' })]);
    const { container } = renderWithProviders(<ActivityFeed />);

    const iconSpan = container.querySelector('.text-dr-red');
    expect(iconSpan).toBeInTheDocument();
    expect(iconSpan?.textContent).toBe('✖');
  });

  it('shows swords icon for in_combat events', () => {
    setEvents([makeEvent({ type: 'in_combat' })]);
    const { container } = renderWithProviders(<ActivityFeed />);

    // The icon span has both text-dr-amber and w-4 classes
    const iconSpan = container.querySelector('.text-dr-amber.w-4');
    expect(iconSpan).toBeInTheDocument();
    expect(iconSpan?.textContent).toBe('⚔');
  });

  it('shows dot icon for created events', () => {
    setEvents([makeEvent({ type: 'created' })]);
    const { container } = renderWithProviders(<ActivityFeed />);

    const iconSpan = container.querySelector('.text-dr-muted');
    expect(iconSpan).toBeInTheDocument();
    expect(iconSpan?.textContent).toBe('●');
  });

  it('accepts className prop', () => {
    setEvents([]);
    const { container } = renderWithProviders(
      <ActivityFeed className="mt-4" />,
    );

    expect(container.firstChild).toHaveClass('mt-4');
  });
});
