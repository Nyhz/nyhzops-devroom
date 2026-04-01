import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock escalation before importing the module under test
const { escalate } = vi.hoisted(() => ({
  escalate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/overseer/escalation', () => ({ escalate }));

const { safeQueueMission } = await import('@/lib/orchestrator/safe-queue');

describe('safeQueueMission', () => {
  const MISSION_ID = 'mission-abc-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).orchestrator;
  });

  it('calls orchestrator.onMissionQueued when orchestrator exists', () => {
    const onMissionQueued = vi.fn();
    (globalThis as Record<string, unknown>).orchestrator = { onMissionQueued };

    safeQueueMission(MISSION_ID);

    expect(onMissionQueued).toHaveBeenCalledOnce();
    expect(onMissionQueued).toHaveBeenCalledWith(MISSION_ID);
  });

  it('does not throw when orchestrator is undefined', () => {
    delete (globalThis as Record<string, unknown>).orchestrator;

    expect(() => safeQueueMission(MISSION_ID)).not.toThrow();
  });

  it('catches errors from onMissionQueued and logs to console.error without throwing', () => {
    const error = new Error('queue exploded');
    const onMissionQueued = vi.fn().mockImplementation(() => {
      throw error;
    });
    (globalThis as Record<string, unknown>).orchestrator = { onMissionQueued };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => safeQueueMission(MISSION_ID)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(MISSION_ID),
      error,
    );

    consoleSpy.mockRestore();
  });

  it('calls escalate with critical level when onMissionQueued throws', () => {
    const error = new Error('queue exploded');
    const onMissionQueued = vi.fn().mockImplementation(() => {
      throw error;
    });
    (globalThis as Record<string, unknown>).orchestrator = { onMissionQueued };

    vi.spyOn(console, 'error').mockImplementation(() => {});

    safeQueueMission(MISSION_ID);

    expect(escalate).toHaveBeenCalledOnce();
    expect(escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'critical',
        entityType: 'mission',
        entityId: MISSION_ID,
      }),
    );
  });

  it('does not call escalate when orchestrator is undefined', () => {
    delete (globalThis as Record<string, unknown>).orchestrator;

    safeQueueMission(MISSION_ID);

    expect(escalate).not.toHaveBeenCalled();
  });

  it('does not call escalate on successful queue', () => {
    const onMissionQueued = vi.fn();
    (globalThis as Record<string, unknown>).orchestrator = { onMissionQueued };

    safeQueueMission(MISSION_ID);

    expect(escalate).not.toHaveBeenCalled();
  });
});
