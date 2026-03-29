'use client';

import { useState } from 'react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import { BoardCard } from './board-card';
import type { IntelNoteWithMission } from '@/types';

const COLLAPSED_LIMIT = 10;
const COLLAPSIBLE_COLUMNS = new Set(['accomplished', 'compromised']);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BoardColumnProps {
  columnKey: string;
  label: string;
  color: string;
  acceptsDrop: boolean;
  cards: IntelNoteWithMission[];
  selectedIds: Set<string>;
  onSelect: (noteId: string) => void;
  onCardClick: (note: IntelNoteWithMission) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BoardColumn({
  columnKey,
  label,
  color,
  acceptsDrop,
  cards,
  selectedIds,
  onSelect,
  onCardClick,
  className,
}: BoardColumnProps) {
  const [expanded, setExpanded] = useState(false);

  const isCollapsible = COLLAPSIBLE_COLUMNS.has(columnKey) && cards.length > COLLAPSED_LIMIT;
  const visibleCards = isCollapsible && !expanded ? cards.slice(0, COLLAPSED_LIMIT) : cards;
  const hiddenCount = cards.length - COLLAPSED_LIMIT;

  return (
    <div className={cn('flex-shrink-0 w-72 flex flex-col min-h-0', className)}>
      {/* Column header */}
      <div className="flex items-baseline justify-between gap-2 px-1.5 pb-2">
        <span className={cn('text-[11px] font-tactical tracking-widest', `text-${color}/50`)}>
          {label}
        </span>
        <span className="text-[10px] text-dr-dim/30">{cards.length || ''}</span>
      </div>

      {/* Droppable zone */}
      <Droppable droppableId={columnKey} isDropDisabled={!acceptsDrop}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              'flex-1 flex flex-col gap-1.5 p-1.5 min-h-[80px] overflow-y-auto',
              'bg-white/[0.02] border border-transparent rounded-sm',
              'transition-colors',
              snapshot.isDraggingOver && acceptsDrop && 'border-dr-amber/20 bg-dr-amber/[0.03]',
            )}
          >
            {visibleCards.map((note, index) => {
              const isLinked = note.missionId !== null;

              if (isLinked) {
                // Linked cards are not draggable — render directly
                return (
                  <BoardCard
                    key={note.id}
                    note={note}
                    isSelected={selectedIds.has(note.id)}
                    onSelect={onSelect}
                    onClick={onCardClick}
                  />
                );
              }

              // Unpromoted notes (no missionId) are draggable
              return (
                <Draggable key={note.id} draggableId={note.id} index={index}>
                  {(dragProvided, dragSnapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      {...dragProvided.dragHandleProps}
                      className={cn(dragSnapshot.isDragging && 'opacity-80')}
                    >
                      <BoardCard
                        note={note}
                        isSelected={selectedIds.has(note.id)}
                        onSelect={onSelect}
                        onClick={onCardClick}
                      />
                    </div>
                  )}
                </Draggable>
              );
            })}

            {isCollapsible && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="text-dr-dim hover:text-dr-muted text-[11px] font-tactical py-2 text-center transition-colors"
              >
                SHOW ALL (+{hiddenCount})
              </button>
            )}

            {isCollapsible && expanded && (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-dr-dim hover:text-dr-muted text-[11px] font-tactical py-2 text-center transition-colors"
              >
                SHOW RECENT
              </button>
            )}

            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
