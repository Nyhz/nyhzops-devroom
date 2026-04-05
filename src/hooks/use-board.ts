'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';
import type { IntelNoteWithMission, MissionStatus } from '@/types';

// Column definitions matching the spec
export const BOARD_COLUMNS = [
  { key: 'tasked', label: 'TASKED', color: 'dr-muted', acceptsDrop: true },
  { key: 'ops_ready', label: 'OPS READY', color: 'dr-muted', acceptsDrop: true },
  { key: 'deploying', label: 'DEPLOYING', color: 'dr-amber', acceptsDrop: false },
  { key: 'in_combat', label: 'IN COMBAT', color: 'dr-amber', acceptsDrop: false },
  { key: 'reviewing', label: 'REVIEWING', color: 'dr-blue', acceptsDrop: false },
  { key: 'accomplished', label: 'ACCOMPLISHED', color: 'dr-green', acceptsDrop: false },
  { key: 'compromised', label: 'COMPROMISED', color: 'dr-red', acceptsDrop: false },
] as const;

// Map mission status to board column key
function getColumnForNote(note: IntelNoteWithMission): string {
  if (note.missionId && note.missionStatus) {
    const status = note.missionStatus;
    if (status === 'standby' || status === 'queued') return 'ops_ready';
    if (status === 'abandoned') return 'abandoned';
    return status;
  }
  if (note.campaignId && !note.missionId) return 'ops_ready';
  return note.column ?? 'tasked';
}

export interface UseBoardReturn {
  columns: Map<string, IntelNoteWithMission[]>;
  updateNoteLocally: (noteId: string, updates: Partial<IntelNoteWithMission>) => void;
  addNoteLocally: (note: IntelNoteWithMission) => void;
  removeNoteLocally: (noteId: string) => void;
}

export function useBoard(
  battlefieldId: string,
  initialNotes: IntelNoteWithMission[],
): UseBoardReturn {
  const [notes, setNotes] = useState<IntelNoteWithMission[]>(initialNotes);
  const socket = useSocket();
  const reconnectKey = useReconnectKey();

  useEffect(() => {
    if (!socket) return;
    socket.emit('battlefield:subscribe', battlefieldId);

    const handleMissionStatus = (data: { missionId: string; status: string }) => {
      setNotes(prev =>
        prev.map(note =>
          note.missionId === data.missionId
            ? { ...note, missionStatus: data.status as MissionStatus }
            : note,
        ),
      );
    };

    socket.on('mission:status', handleMissionStatus);
    return () => {
      socket.off('mission:status', handleMissionStatus);
      socket.emit('battlefield:unsubscribe', battlefieldId);
    };
  }, [socket, battlefieldId, reconnectKey]);

  // Build column map
  const columns = new Map<string, IntelNoteWithMission[]>();
  for (const col of BOARD_COLUMNS) {
    columns.set(col.key, []);
  }
  for (const note of notes) {
    const colKey = getColumnForNote(note);
    if (colKey === 'abandoned') continue;
    const col = columns.get(colKey);
    if (col) col.push(note);
  }
  // Sort: unpromoted by position, linked by createdAt desc
  for (const [, cards] of columns) {
    cards.sort((a, b) => {
      if (!a.missionId && !b.missionId) return (a.position ?? 0) - (b.position ?? 0);
      if (!a.missionId) return -1;
      if (!b.missionId) return 1;
      return (b.missionCreatedAt ?? 0) - (a.missionCreatedAt ?? 0);
    });
  }

  const updateNoteLocally = useCallback((noteId: string, updates: Partial<IntelNoteWithMission>) => {
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, ...updates } : n));
  }, []);

  const addNoteLocally = useCallback((note: IntelNoteWithMission) => {
    setNotes(prev => [note, ...prev]);
  }, []);

  const removeNoteLocally = useCallback((noteId: string) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
  }, []);

  return { columns, updateNoteLocally, addNoteLocally, removeNoteLocally };
}
