'use client';

import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/hooks/use-confirm';
import { InlineEdit } from './inline-edit';
import { missionId } from './plan-editor-utils';
import { SortableMissionItem } from './sortable-mission-item';
import type { PlanPhase, PlanMission } from '@/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SortablePhaseItemProps {
  id: string;
  phase: PlanPhase;
  phaseIndex: number;
  assets: Array<{ id: string; codename: string; specialty: string }>;
  onUpdatePhase: (field: keyof PlanPhase, value: string) => void;
  onDeletePhase: () => void;
  onUpdateMission: (
    missionIndex: number,
    field: keyof PlanMission,
    value: PlanMission[keyof PlanMission],
  ) => void;
  onDeleteMission: (missionIndex: number) => void;
  onAddMission: () => void;
}

// ---------------------------------------------------------------------------
// SortablePhaseItem — draggable phase container
// ---------------------------------------------------------------------------

export function SortablePhaseItem({
  id,
  phase,
  phaseIndex,
  assets,
  onUpdatePhase,
  onDeletePhase,
  onUpdateMission,
  onDeleteMission,
  onAddMission,
}: SortablePhaseItemProps) {
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const missionIds = phase.missions.map((_, mi) => missionId(phaseIndex, mi));

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-dr-surface border border-dr-border border-l-2 border-l-dr-amber',
        isDragging && 'shadow-glow-amber opacity-90 z-50',
      )}
    >
      {/* Phase header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-dr-elevated border-b border-dr-border">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-dr-amber hover:text-dr-green text-lg shrink-0"
          title="Drag to reorder phase"
        >
          ⠿
        </button>
        <span className="text-xs text-dr-muted uppercase tracking-wider shrink-0">
          PHASE {phaseIndex + 1}
        </span>
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={phase.name}
            onChange={(v) => onUpdatePhase('name', v)}
            placeholder="Phase name"
            className="font-tactical text-sm text-dr-amber"
          />
        </div>
        <span className="text-xs text-dr-muted font-tactical">
          {phase.missions.length} mission{phase.missions.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={async () => {
            if (phase.missions.length > 0) {
              const result = await confirmDelete({
                title: 'DELETE PHASE',
                description: `Delete "${phase.name || `Phase ${phaseIndex + 1}`}" and its ${phase.missions.length} mission(s)?`,
                actions: [{ label: 'DELETE', variant: 'danger' }],
              });
              if (result !== 0) return;
            }
            onDeletePhase();
          }}
          className="text-dr-dim hover:text-dr-red text-xs shrink-0"
          title="Delete phase"
        >
          ✕
        </button>
      </div>

      {/* Phase objective */}
      <div className="px-4 py-2 border-b border-dr-border/50">
        <span className="text-xs text-dr-muted uppercase tracking-wider mr-2">
          OBJECTIVE
        </span>
        <InlineEdit
          value={phase.objective}
          onChange={(v) => onUpdatePhase('objective', v)}
          placeholder="Phase objective"
          multiline
          className="text-xs text-dr-muted"
        />
      </div>

      {/* Missions — horizontal layout */}
      <div className="p-4">
        <SortableContext items={missionIds} strategy={horizontalListSortingStrategy}>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {phase.missions.map((mission, mi) => (
              <SortableMissionItem
                key={missionId(phaseIndex, mi)}
                id={missionId(phaseIndex, mi)}
                mission={mission}
                phaseIndex={phaseIndex}
                missionIndex={mi}
                phaseMissions={phase.missions}
                assets={assets}
                onUpdate={(field, value) => onUpdateMission(mi, field, value)}
                onDelete={() => onDeleteMission(mi)}
              />
            ))}
            {/* Add mission button */}
            <button
              onClick={onAddMission}
              className={cn(
                'border border-dashed border-dr-border hover:border-dr-amber',
                'min-w-[160px] min-h-[80px] flex items-center justify-center shrink-0',
                'text-dr-dim hover:text-dr-amber font-tactical text-xs uppercase tracking-wider',
                'transition-colors hover:bg-dr-amber/5',
              )}
            >
              + ADD MISSION
            </button>
          </div>
        </SortableContext>
      </div>

      <ConfirmDeleteDialog />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseOverlay — simplified phase for DragOverlay
// ---------------------------------------------------------------------------

export function PhaseOverlay({ phase, phaseIndex }: { phase: PlanPhase; phaseIndex: number }) {
  return (
    <div className="bg-dr-surface border border-dr-amber border-l-2 border-l-dr-amber shadow-glow-amber opacity-90 p-4">
      <div className="flex items-center gap-3">
        <span className="text-dr-amber text-lg">⠿</span>
        <span className="text-xs text-dr-muted uppercase tracking-wider">
          PHASE {phaseIndex + 1}
        </span>
        <span className="font-tactical text-sm text-dr-amber">
          {phase.name || '(unnamed)'}
        </span>
        <span className="text-xs text-dr-muted font-tactical ml-auto">
          {phase.missions.length} mission{phase.missions.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
