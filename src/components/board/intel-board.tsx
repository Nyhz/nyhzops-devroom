'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { BoardColumn } from './board-column';
import { NotePanel } from './note-panel';
import { useBoard, BOARD_COLUMNS } from '@/hooks/use-board';
import { moveNote } from '@/actions/intel';
import type { IntelNoteWithMission, IntelNoteColumn } from '@/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface IntelBoardProps {
  battlefieldId: string;
  initialNotes: IntelNoteWithMission[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IntelBoard({ battlefieldId, initialNotes }: IntelBoardProps) {
  const router = useRouter();

  // Multi-select state (only applies to unpromoted notes)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Panel state: null = closed, 'create' = new note form, note = edit/view
  const [panelNote, setPanelNote] = useState<IntelNoteWithMission | null | 'create'>(null);

  const { columns, updateNoteLocally, addNoteLocally, removeNoteLocally } = useBoard(
    battlefieldId,
    initialNotes,
  );

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const handleSelect = useCallback((noteId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Card click
  // ---------------------------------------------------------------------------

  const handleCardClick = useCallback(
    (note: IntelNoteWithMission) => {
      if (note.missionId) {
        router.push(`/battlefields/${battlefieldId}/missions/${note.missionId}`);
      } else {
        setPanelNote(note);
      }
    },
    [router, battlefieldId],
  );

  // ---------------------------------------------------------------------------
  // Drag end
  // ---------------------------------------------------------------------------

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination } = result;

      if (!destination) return;

      const targetColumn = destination.droppableId as IntelNoteColumn;

      // Only accept drops on valid droppable columns
      const validColumns: string[] = ['backlog', 'planned'];
      if (!validColumns.includes(targetColumn)) return;

      const targetPosition = destination.index;

      // Optimistic update
      updateNoteLocally(draggableId, {
        column: targetColumn,
        position: targetPosition,
      });

      // Persist
      moveNote(draggableId, targetColumn, targetPosition).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Move failed';
        toast.error(`Failed to move note: ${message}`);
        // The optimistic update stays — a full refresh would fix it,
        // but we avoid reverting to keep UX smooth.
      });
    },
    [updateNoteLocally],
  );

  // ---------------------------------------------------------------------------
  // Promote — single mission
  // ---------------------------------------------------------------------------

  const handlePromoteMission = useCallback(
    (note: IntelNoteWithMission) => {
      const briefing = `# ${note.title}\n\n${note.description ?? ''}`;
      const params = new URLSearchParams({ briefing, noteId: note.id });
      router.push(`/battlefields/${battlefieldId}?${params.toString()}`);
    },
    [router, battlefieldId],
  );

  // ---------------------------------------------------------------------------
  // Promote — multi-note campaign
  // ---------------------------------------------------------------------------

  const handlePromoteCampaign = useCallback(
    (notes: IntelNoteWithMission[]) => {
      const objective = notes
        .map(n => `## ${n.title}\n${n.description ?? ''}`)
        .join('\n\n');
      const noteIds = notes.map(n => n.id).join(',');
      const params = new URLSearchParams({ objective, noteIds });
      router.push(`/battlefields/${battlefieldId}/campaigns/new?${params.toString()}`);
    },
    [router, battlefieldId],
  );

  // ---------------------------------------------------------------------------
  // Header button handlers
  // ---------------------------------------------------------------------------

  const handleDeployMission = useCallback(() => {
    if (selectedIds.size !== 1) return;
    const [noteId] = [...selectedIds];
    // Find the note across all columns
    for (const cards of columns.values()) {
      const note = cards.find(c => c.id === noteId);
      if (note) {
        handlePromoteMission(note);
        return;
      }
    }
  }, [selectedIds, columns, handlePromoteMission]);

  const handleLaunchCampaign = useCallback(() => {
    if (selectedIds.size === 0) return;
    const selectedNotes: IntelNoteWithMission[] = [];
    for (const cards of columns.values()) {
      for (const card of cards) {
        if (selectedIds.has(card.id)) {
          selectedNotes.push(card);
        }
      }
    }
    if (selectedNotes.length > 0) {
      handlePromoteCampaign(selectedNotes);
    }
  }, [selectedIds, columns, handlePromoteCampaign]);

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  const activeStatuses = new Set(['deploying', 'in_combat', 'reviewing']);
  let totalCards = 0;
  let activeCards = 0;

  for (const cards of columns.values()) {
    totalCards += cards.length;
    for (const card of cards) {
      if (card.missionId && card.missionStatus && activeStatuses.has(card.missionStatus)) {
        activeCards++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Panel callbacks
  // ---------------------------------------------------------------------------

  const handlePanelClose = useCallback(() => setPanelNote(null), []);

  const handlePanelCreated = useCallback(
    (note: IntelNoteWithMission) => {
      addNoteLocally(note);
    },
    [addNoteLocally],
  );

  const handlePanelUpdated = useCallback(
    (noteId: string, updates: Partial<IntelNoteWithMission>) => {
      updateNoteLocally(noteId, updates);
    },
    [updateNoteLocally],
  );

  const handlePanelDeleted = useCallback(
    (noteId: string) => {
      removeNoteLocally(noteId);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });
    },
    [removeNoteLocally],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const panelNoteValue = panelNote === 'create' ? null : panelNote;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-dr-border flex-shrink-0">
        {/* Left */}
        <div className="flex items-center gap-3">
          <span className="font-tactical text-dr-text tracking-widest text-sm">
            ⊞ INTEL BOARD
          </span>
          <span className="font-tactical text-dr-muted text-xs">
            {totalCards} cards · {activeCards} active
          </span>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          <TacButton
            variant="ghost"
            size="sm"
            onClick={() => setPanelNote('create')}
          >
            + NEW NOTE
          </TacButton>

          {selectedIds.size === 1 && (
            <TacButton
              variant="primary"
              size="sm"
              onClick={handleDeployMission}
            >
              DEPLOY MISSION
            </TacButton>
          )}

          {selectedIds.size >= 1 && (
            <TacButton
              variant="success"
              size="sm"
              onClick={handleLaunchCampaign}
            >
              ⚡ LAUNCH CAMPAIGN ({selectedIds.size})
            </TacButton>
          )}
        </div>
      </div>

      {/* Board columns */}
      <div className="flex-1 overflow-auto min-h-0">
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-3 items-start px-6 py-4 min-w-max">
            {BOARD_COLUMNS.map(col => (
              <BoardColumn
                key={col.key}
                columnKey={col.key}
                label={col.label}
                color={col.color}
                acceptsDrop={col.acceptsDrop}
                cards={columns.get(col.key) ?? []}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onCardClick={handleCardClick}
              />
            ))}
          </div>
        </DragDropContext>
      </div>

      {/* Note panel — shown when panelNote is not null */}
      {panelNote !== null && (
        <NotePanel
          battlefieldId={battlefieldId}
          note={panelNoteValue}
          onClose={handlePanelClose}
          onCreated={handlePanelCreated}
          onUpdated={handlePanelUpdated}
          onDeleted={handlePanelDeleted}
          onPromoteMission={handlePromoteMission}
          onPromoteCampaign={handlePromoteCampaign}
        />
      )}
    </div>
  );
}
