import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMissionComms } from '@/hooks/use-mission-comms';
import { mockSocket } from '@/lib/test/component-setup';

// Verifies that `useMissionComms` removes every socket listener it registers
// and emits a `mission:unsubscribe` on unmount. Regression coverage for the
// reliability-sweep audit: a missing cleanup would leak handlers across
// mission detail navigations and fan-out events into stale React trees.
describe('useMissionComms cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes all listeners and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() =>
      useMissionComms('M1', [], 'in_combat'),
    );

    // The effect registers exactly four listeners: log, status, debrief,
    // tokens. If the hook ever adds a new event it must also be cleaned up;
    // this assertion will fail loudly and force the cleanup branch to follow.
    const registeredEvents = mockSocket.on.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .sort();
    expect(registeredEvents).toEqual(
      ['mission:debrief', 'mission:log', 'mission:status', 'mission:tokens'].sort(),
    );

    // And it subscribed to the mission room.
    expect(mockSocket.emit).toHaveBeenCalledWith('mission:subscribe', 'M1');

    const onCount = mockSocket.on.mock.calls.length;
    unmount();

    // Every `.on` has a matching `.off`.
    expect(mockSocket.off.mock.calls.length).toBe(onCount);
    const removedEvents = mockSocket.off.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .sort();
    expect(removedEvents).toEqual(registeredEvents);

    // And it emitted a matching `mission:unsubscribe` on teardown.
    const unsubEmit = mockSocket.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'mission:unsubscribe',
    );
    expect(unsubEmit).toBeDefined();
    expect(unsubEmit?.[1]).toBe('M1');
  });
});
