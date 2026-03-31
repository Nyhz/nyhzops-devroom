import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { mockSocket } from '@/lib/test/component-setup';
import { LiveStatusBadge } from '../live-status-badge';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LiveStatusBadge', () => {
  it('renders the initial status text', () => {
    renderWithProviders(
      <LiveStatusBadge missionId="m1" initialStatus="standby" />,
    );
    expect(screen.getByText('STANDBY')).toBeInTheDocument();
  });

  it('subscribes to mission status on mount', () => {
    renderWithProviders(
      <LiveStatusBadge missionId="m1" initialStatus="standby" />,
    );
    expect(mockSocket.emit).toHaveBeenCalledWith('mission:subscribe', 'm1');
  });

  it('registers mission:status event listener', () => {
    renderWithProviders(
      <LiveStatusBadge missionId="m1" initialStatus="standby" />,
    );
    expect(mockSocket.on).toHaveBeenCalledWith('mission:status', expect.any(Function));
  });

  it('updates status when socket event matches missionId', () => {
    renderWithProviders(
      <LiveStatusBadge missionId="m1" initialStatus="standby" />,
    );

    // Get the handler registered with socket.on
    const onCall = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'mission:status',
    );
    const handler = onCall![1] as (data: { missionId: string; status: string }) => void;

    act(() => {
      handler({ missionId: 'm1', status: 'in_combat' });
    });

    expect(screen.getByText('IN COMBAT')).toBeInTheDocument();
    expect(screen.queryByText('STANDBY')).not.toBeInTheDocument();
  });

  it('ignores socket events for other missionIds', () => {
    renderWithProviders(
      <LiveStatusBadge missionId="m1" initialStatus="standby" />,
    );

    const onCall = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'mission:status',
    );
    const handler = onCall![1] as (data: { missionId: string; status: string }) => void;

    act(() => {
      handler({ missionId: 'm2', status: 'accomplished' });
    });

    expect(screen.getByText('STANDBY')).toBeInTheDocument();
    expect(screen.queryByText('ACCOMPLISHED')).not.toBeInTheDocument();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderWithProviders(
      <LiveStatusBadge missionId="m1" initialStatus="standby" />,
    );

    unmount();

    expect(mockSocket.off).toHaveBeenCalledWith('mission:status', expect.any(Function));
    expect(mockSocket.emit).toHaveBeenCalledWith('mission:unsubscribe', 'm1');
  });

  it('renders correct color for each status', () => {
    const statuses = [
      { status: 'accomplished', expected: 'ACCOMPLISHED' },
      { status: 'in_combat', expected: 'IN COMBAT' },
      { status: 'compromised', expected: 'COMPROMISED' },
      { status: 'deploying', expected: 'DEPLOYING' },
      { status: 'queued', expected: 'QUEUED' },
      { status: 'reviewing', expected: 'REVIEWING' },
      { status: 'abandoned', expected: 'ABANDONED' },
    ];

    for (const { status, expected } of statuses) {
      const { unmount } = renderWithProviders(
        <LiveStatusBadge missionId="m1" initialStatus={status} />,
      );
      expect(screen.getByText(expected)).toBeInTheDocument();
      unmount();
    }
  });
});
