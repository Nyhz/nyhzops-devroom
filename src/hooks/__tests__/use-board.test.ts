import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBoard, BOARD_COLUMNS } from '@/hooks/use-board';
import { mockSocket } from '@/lib/test/component-setup';
import type { IntelNoteWithMission } from '@/types';

function makeNote(overrides: Partial<IntelNoteWithMission> = {}): IntelNoteWithMission {
  return {
    id: 'note-1',
    battlefieldId: 'bf-1',
    title: 'Test Note',
    description: null,
    column: 'backlog',
    position: 0,
    missionId: null,
    campaignId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    missionStatus: null,
    missionAssetCodename: null,
    missionCreatedAt: null,
    ...overrides,
  };
}

describe('useBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('column initialization', () => {
    it('creates all 7 board columns', () => {
      const { result } = renderHook(() => useBoard('bf-1', []));
      expect(result.current.columns.size).toBe(7);
      for (const col of BOARD_COLUMNS) {
        expect(result.current.columns.has(col.key)).toBe(true);
      }
    });

    it('places unlinked notes by their column field', () => {
      const notes = [
        makeNote({ id: 'n1', column: 'backlog', position: 0 }),
        makeNote({ id: 'n2', column: 'planned', position: 0 }),
      ];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      expect(result.current.columns.get('backlog')!.map((n) => n.id)).toEqual(['n1']);
      expect(result.current.columns.get('planned')!.map((n) => n.id)).toEqual(['n2']);
    });

    it('places linked notes by mission status', () => {
      const notes = [
        makeNote({ id: 'n1', missionId: 'm1', missionStatus: 'deploying', missionCreatedAt: 1000 }),
        makeNote({ id: 'n2', missionId: 'm2', missionStatus: 'in_combat', missionCreatedAt: 2000 }),
        makeNote({ id: 'n3', missionId: 'm3', missionStatus: 'accomplished', missionCreatedAt: 3000 }),
      ];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      expect(result.current.columns.get('deploying')!.map((n) => n.id)).toEqual(['n1']);
      expect(result.current.columns.get('in_combat')!.map((n) => n.id)).toEqual(['n2']);
      expect(result.current.columns.get('accomplished')!.map((n) => n.id)).toEqual(['n3']);
    });

    it('maps standby/queued missions to planned column', () => {
      const notes = [
        makeNote({ id: 'n1', missionId: 'm1', missionStatus: 'standby', missionCreatedAt: 1000 }),
        makeNote({ id: 'n2', missionId: 'm2', missionStatus: 'queued', missionCreatedAt: 2000 }),
      ];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      const planned = result.current.columns.get('planned')!;
      expect(planned.map((n) => n.id)).toContain('n1');
      expect(planned.map((n) => n.id)).toContain('n2');
    });

    it('excludes abandoned missions', () => {
      const notes = [
        makeNote({ id: 'n1', missionId: 'm1', missionStatus: 'abandoned', missionCreatedAt: 1000 }),
      ];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      // Should not appear in any column
      for (const [, cards] of result.current.columns) {
        expect(cards.find((n) => n.id === 'n1')).toBeUndefined();
      }
    });

    it('places campaign-only notes (no mission) in planned', () => {
      const notes = [
        makeNote({ id: 'n1', campaignId: 'camp-1', missionId: null }),
      ];
      const { result } = renderHook(() => useBoard('bf-1', notes));
      expect(result.current.columns.get('planned')!.map((n) => n.id)).toEqual(['n1']);
    });
  });

  describe('sorting', () => {
    it('sorts unlinked notes by position ascending', () => {
      const notes = [
        makeNote({ id: 'n2', column: 'backlog', position: 2 }),
        makeNote({ id: 'n1', column: 'backlog', position: 0 }),
        makeNote({ id: 'n3', column: 'backlog', position: 1 }),
      ];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      const backlog = result.current.columns.get('backlog')!;
      expect(backlog.map((n) => n.id)).toEqual(['n1', 'n3', 'n2']);
    });

    it('sorts linked notes by missionCreatedAt descending', () => {
      const notes = [
        makeNote({ id: 'n1', missionId: 'm1', missionStatus: 'in_combat', missionCreatedAt: 1000 }),
        makeNote({ id: 'n2', missionId: 'm2', missionStatus: 'in_combat', missionCreatedAt: 3000 }),
        makeNote({ id: 'n3', missionId: 'm3', missionStatus: 'in_combat', missionCreatedAt: 2000 }),
      ];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      const inCombat = result.current.columns.get('in_combat')!;
      expect(inCombat.map((n) => n.id)).toEqual(['n2', 'n3', 'n1']);
    });

    it('places unlinked notes before linked notes in same column', () => {
      const notes = [
        makeNote({ id: 'linked', missionId: 'm1', missionStatus: 'standby', missionCreatedAt: 1000 }),
        makeNote({ id: 'unlinked', column: 'planned', position: 0 }),
      ];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      const planned = result.current.columns.get('planned')!;
      expect(planned[0].id).toBe('unlinked');
      expect(planned[1].id).toBe('linked');
    });
  });

  describe('socket subscription', () => {
    it('subscribes to battlefield on mount', () => {
      renderHook(() => useBoard('bf-1', []));
      expect(mockSocket.emit).toHaveBeenCalledWith('battlefield:subscribe', 'bf-1');
      expect(mockSocket.on).toHaveBeenCalledWith('mission:status', expect.any(Function));
    });

    it('unsubscribes on unmount', () => {
      const { unmount } = renderHook(() => useBoard('bf-1', []));
      unmount();
      expect(mockSocket.off).toHaveBeenCalledWith('mission:status', expect.any(Function));
      expect(mockSocket.emit).toHaveBeenCalledWith('battlefield:unsubscribe', 'bf-1');
    });

    it('updates note column when mission status changes via socket', () => {
      const notes = [
        makeNote({ id: 'n1', missionId: 'm1', missionStatus: 'deploying', missionCreatedAt: 1000 }),
      ];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      // Initially in deploying
      expect(result.current.columns.get('deploying')!.map((n) => n.id)).toEqual(['n1']);

      // Simulate mission status change
      const onCall = mockSocket.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'mission:status',
      );
      const handler = onCall![1] as (data: { missionId: string; status: string }) => void;

      act(() => {
        handler({ missionId: 'm1', status: 'in_combat' });
      });

      expect(result.current.columns.get('deploying')!).toHaveLength(0);
      expect(result.current.columns.get('in_combat')!.map((n) => n.id)).toEqual(['n1']);
    });
  });

  describe('local mutations', () => {
    it('updateNoteLocally updates note fields', () => {
      const notes = [makeNote({ id: 'n1', title: 'Original' })];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      act(() => {
        result.current.updateNoteLocally('n1', { title: 'Updated' });
      });

      const backlog = result.current.columns.get('backlog')!;
      expect(backlog[0].title).toBe('Updated');
    });

    it('addNoteLocally prepends a note', () => {
      const notes = [makeNote({ id: 'n1', column: 'backlog', position: 0 })];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      act(() => {
        result.current.addNoteLocally(makeNote({ id: 'n2', column: 'backlog', position: -1 }));
      });

      const backlog = result.current.columns.get('backlog')!;
      expect(backlog.map((n) => n.id)).toContain('n2');
      expect(backlog.map((n) => n.id)).toContain('n1');
    });

    it('removeNoteLocally removes a note', () => {
      const notes = [
        makeNote({ id: 'n1', column: 'backlog' }),
        makeNote({ id: 'n2', column: 'backlog' }),
      ];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      act(() => {
        result.current.removeNoteLocally('n1');
      });

      const backlog = result.current.columns.get('backlog')!;
      expect(backlog.map((n) => n.id)).toEqual(['n2']);
    });

    it('removeNoteLocally is a no-op for non-existent note', () => {
      const notes = [makeNote({ id: 'n1' })];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      act(() => {
        result.current.removeNoteLocally('nonexistent');
      });

      const backlog = result.current.columns.get('backlog')!;
      expect(backlog).toHaveLength(1);
    });

    it('updateNoteLocally can change column placement', () => {
      const notes = [makeNote({ id: 'n1', column: 'backlog' })];
      const { result } = renderHook(() => useBoard('bf-1', notes));

      act(() => {
        result.current.updateNoteLocally('n1', { column: 'planned' });
      });

      expect(result.current.columns.get('backlog')!).toHaveLength(0);
      expect(result.current.columns.get('planned')!.map((n) => n.id)).toEqual(['n1']);
    });
  });

  describe('BOARD_COLUMNS', () => {
    it('only backlog and planned accept drops', () => {
      const droppable = BOARD_COLUMNS.filter((c) => c.acceptsDrop);
      expect(droppable.map((c) => c.key)).toEqual(['backlog', 'planned']);
    });

    it('has 7 columns total', () => {
      expect(BOARD_COLUMNS).toHaveLength(7);
    });
  });
});
