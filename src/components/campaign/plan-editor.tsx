'use client';

import { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput, TacTextarea } from '@/components/ui/tac-input';
import { updateBattlePlan } from '@/actions/campaign';
import type { PlanJSON, PlanPhase, PlanMission, MissionPriority } from '@/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PlanEditorProps {
  campaignId: string;
  battlefieldId: string;
  initialPlan: PlanJSON;
  assets: Array<{ id: string; codename: string; specialty: string }>;
}

// ---------------------------------------------------------------------------
// ID helpers — encode phase/mission indices into unique drag IDs
// ---------------------------------------------------------------------------

function phaseId(index: number): string {
  return `phase-${index}`;
}

function missionId(phaseIndex: number, missionIndex: number): string {
  return `mission-${phaseIndex}-${missionIndex}`;
}

function parseMissionId(id: string): { phaseIndex: number; missionIndex: number } | null {
  const match = id.match(/^mission-(\d+)-(\d+)$/);
  if (!match) return null;
  return { phaseIndex: Number(match[1]), missionIndex: Number(match[2]) };
}

function parsePhaseId(id: string): number | null {
  const match = id.match(/^phase-(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

// ---------------------------------------------------------------------------
// Priority config
// ---------------------------------------------------------------------------

const PRIORITIES: MissionPriority[] = ['low', 'normal', 'high', 'critical'];

const priorityDotColor: Record<string, string> = {
  low: 'bg-dr-dim',
  normal: 'bg-dr-muted',
  high: 'bg-dr-amber',
  critical: 'bg-dr-red',
};

// ---------------------------------------------------------------------------
// InlineEdit — click-to-edit text field
// ---------------------------------------------------------------------------

function InlineEdit({
  value,
  onChange,
  placeholder,
  multiline,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = useCallback(() => {
    setEditing(false);
    if (draft !== value) {
      onChange(draft);
    }
  }, [draft, value, onChange]);

  if (editing) {
    if (multiline) {
      return (
        <TacTextarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(value);
              setEditing(false);
            }
          }}
          placeholder={placeholder}
          className={cn('min-h-[60px] text-xs', className)}
        />
      );
    }
    return (
      <TacInput
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        className={cn('text-xs', className)}
      />
    );
  }

  return (
    <span
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={cn(
        'cursor-pointer hover:bg-dr-elevated/50 px-1 -mx-1 transition-colors',
        !value && 'text-dr-dim italic',
        className,
      )}
      title="Click to edit"
    >
      {value || placeholder || '(empty)'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SortableMissionItem — draggable mission card within a phase
// ---------------------------------------------------------------------------

function SortableMissionItem({
  id,
  mission,
  phaseIndex,
  missionIndex,
  phaseMissions,
  assets,
  onUpdate,
  onDelete,
}: {
  id: string;
  mission: PlanMission;
  phaseIndex: number;
  missionIndex: number;
  phaseMissions: PlanMission[];
  assets: PlanEditorProps['assets'];
  onUpdate: (field: keyof PlanMission, value: PlanMission[keyof PlanMission]) => void;
  onDelete: () => void;
}) {
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [showDepPicker, setShowDepPicker] = useState(false);

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

  const dotColor = priorityDotColor[mission.priority] ?? 'bg-dr-muted';
  const siblingTitles = phaseMissions
    .filter((_, i) => i !== missionIndex)
    .map((m) => m.title)
    .filter(Boolean);
  const currentDeps = mission.dependsOn ?? [];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-dr-elevated border border-dr-border p-3 min-w-[240px] max-w-[320px] flex flex-col gap-2 shrink-0',
        isDragging && 'shadow-glow-amber opacity-90 z-50',
      )}
    >
      {/* Header: drag handle + title + delete */}
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-dr-amber hover:text-dr-green mt-0.5 text-sm shrink-0"
          title="Drag to reorder"
        >
          ⠿
        </button>
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={mission.title}
            onChange={(v) => onUpdate('title', v)}
            placeholder="Mission title"
            className="font-tactical text-sm text-dr-text"
          />
        </div>
        <span
          className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dotColor)}
          title={`Priority: ${mission.priority}`}
        />
        <button
          onClick={onDelete}
          className="text-dr-dim hover:text-dr-red text-xs shrink-0"
          title="Delete mission"
        >
          ✕
        </button>
      </div>

      {/* Briefing toggle */}
      <button
        onClick={() => setBriefingExpanded(!briefingExpanded)}
        className="text-left text-[10px] text-dr-dim uppercase tracking-wider hover:text-dr-muted"
      >
        {briefingExpanded ? '▾ BRIEFING' : '▸ BRIEFING'}
      </button>
      {briefingExpanded && (
        <TacTextarea
          value={mission.briefing}
          onChange={(e) => onUpdate('briefing', e.target.value)}
          placeholder="Mission briefing..."
          className="min-h-[80px] text-xs"
        />
      )}

      {/* Asset selector */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-dr-dim uppercase tracking-wider shrink-0">
          ASSET
        </span>
        <select
          value={mission.assetCodename}
          onChange={(e) => onUpdate('assetCodename', e.target.value)}
          className="flex-1 bg-dr-bg border border-dr-border text-dr-text font-tactical text-xs px-2 py-1 focus:border-dr-amber focus:outline-none"
        >
          <option value="">— unassigned —</option>
          {assets.map((a) => (
            <option key={a.id} value={a.codename}>
              {a.codename}
            </option>
          ))}
        </select>
      </div>

      {/* Priority selector */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-dr-dim uppercase tracking-wider shrink-0">
          PRIORITY
        </span>
        <select
          value={mission.priority}
          onChange={(e) => onUpdate('priority', e.target.value as MissionPriority)}
          className="flex-1 bg-dr-bg border border-dr-border text-dr-text font-tactical text-xs px-2 py-1 focus:border-dr-amber focus:outline-none"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* DependsOn tags */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-dr-dim uppercase tracking-wider shrink-0">
          DEPS
        </span>
        {currentDeps.map((dep) => (
          <span
            key={dep}
            className="inline-flex items-center gap-1 bg-dr-bg border border-dr-border text-dr-muted text-[10px] px-1.5 py-0.5 font-tactical"
          >
            {dep}
            <button
              onClick={() =>
                onUpdate(
                  'dependsOn',
                  currentDeps.filter((d) => d !== dep),
                )
              }
              className="text-dr-dim hover:text-dr-red"
            >
              ✕
            </button>
          </span>
        ))}
        {siblingTitles.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowDepPicker(!showDepPicker)}
              className="text-dr-dim hover:text-dr-amber text-xs font-tactical"
              title="Add dependency"
            >
              [+]
            </button>
            {showDepPicker && (
              <div className="absolute left-0 top-full mt-1 z-40 bg-dr-surface border border-dr-border p-1 min-w-[180px] max-h-[160px] overflow-y-auto">
                {siblingTitles
                  .filter((t) => !currentDeps.includes(t))
                  .map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        onUpdate('dependsOn', [...currentDeps, t]);
                        setShowDepPicker(false);
                      }}
                      className="block w-full text-left text-xs text-dr-text hover:bg-dr-elevated px-2 py-1 font-tactical truncate"
                    >
                      {t}
                    </button>
                  ))}
                {siblingTitles.filter((t) => !currentDeps.includes(t)).length === 0 && (
                  <span className="block text-xs text-dr-dim px-2 py-1 font-tactical">
                    No available missions
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MissionOverlay — simplified card for DragOverlay
// ---------------------------------------------------------------------------

function MissionOverlay({ mission }: { mission: PlanMission }) {
  const dotColor = priorityDotColor[mission.priority] ?? 'bg-dr-muted';
  return (
    <div className="bg-dr-elevated border border-dr-amber p-3 min-w-[240px] max-w-[320px] shadow-glow-amber opacity-90">
      <div className="flex items-center gap-2">
        <span className="text-dr-amber text-sm">⠿</span>
        <span className="font-tactical text-sm text-dr-text truncate flex-1">
          {mission.title || '(untitled)'}
        </span>
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dotColor)} />
      </div>
      {mission.assetCodename && (
        <span className="text-[10px] text-dr-dim font-tactical pl-5">
          {mission.assetCodename}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortablePhaseItem — draggable phase container
// ---------------------------------------------------------------------------

function SortablePhaseItem({
  id,
  phase,
  phaseIndex,
  assets,
  onUpdatePhase,
  onDeletePhase,
  onUpdateMission,
  onDeleteMission,
  onAddMission,
}: {
  id: string;
  phase: PlanPhase;
  phaseIndex: number;
  assets: PlanEditorProps['assets'];
  onUpdatePhase: (field: keyof PlanPhase, value: string) => void;
  onDeletePhase: () => void;
  onUpdateMission: (
    missionIndex: number,
    field: keyof PlanMission,
    value: PlanMission[keyof PlanMission],
  ) => void;
  onDeleteMission: (missionIndex: number) => void;
  onAddMission: () => void;
}) {
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
        <span className="text-[10px] text-dr-dim uppercase tracking-wider shrink-0">
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
        <span className="text-[10px] text-dr-dim font-tactical">
          {phase.missions.length} mission{phase.missions.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => {
            if (
              phase.missions.length > 0 &&
              !window.confirm(
                `Delete phase "${phase.name || `Phase ${phaseIndex + 1}`}" and its ${phase.missions.length} mission(s)?`,
              )
            ) {
              return;
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
        <span className="text-[10px] text-dr-dim uppercase tracking-wider mr-2">
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseOverlay — simplified phase for DragOverlay
// ---------------------------------------------------------------------------

function PhaseOverlay({ phase, phaseIndex }: { phase: PlanPhase; phaseIndex: number }) {
  return (
    <div className="bg-dr-surface border border-dr-amber border-l-2 border-l-dr-amber shadow-glow-amber opacity-90 p-4">
      <div className="flex items-center gap-3">
        <span className="text-dr-amber text-lg">⠿</span>
        <span className="text-[10px] text-dr-dim uppercase tracking-wider">
          PHASE {phaseIndex + 1}
        </span>
        <span className="font-tactical text-sm text-dr-amber">
          {phase.name || '(unnamed)'}
        </span>
        <span className="text-[10px] text-dr-dim font-tactical ml-auto">
          {phase.missions.length} mission{phase.missions.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanEditor — main component
// ---------------------------------------------------------------------------

export function PlanEditor({
  campaignId,
  battlefieldId,
  initialPlan,
  assets,
}: PlanEditorProps) {
  const [plan, setPlan] = useState<PlanJSON>(() => ({
    summary: initialPlan.summary || '',
    phases: initialPlan.phases.map((p) => ({
      ...p,
      missions: p.missions.map((m) => ({ ...m })),
    })),
  }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Track active drag item
  const [activeDragId, setActiveDragId] = useState<UniqueIdentifier | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  // -----------------------------------------------------------------------
  // Plan mutations (all update state + mark dirty)
  // -----------------------------------------------------------------------

  const updatePlan = useCallback((updater: (prev: PlanJSON) => PlanJSON) => {
    setPlan((prev) => {
      const next = updater(prev);
      return next;
    });
    setDirty(true);
  }, []);

  const updatePhase = useCallback(
    (phaseIndex: number, field: keyof PlanPhase, value: string) => {
      updatePlan((prev) => {
        const phases = [...prev.phases];
        phases[phaseIndex] = { ...phases[phaseIndex], [field]: value };
        return { ...prev, phases };
      });
    },
    [updatePlan],
  );

  const deletePhase = useCallback(
    (phaseIndex: number) => {
      updatePlan((prev) => ({
        ...prev,
        phases: prev.phases.filter((_, i) => i !== phaseIndex),
      }));
    },
    [updatePlan],
  );

  const addPhase = useCallback(() => {
    updatePlan((prev) => ({
      ...prev,
      phases: [
        ...prev.phases,
        {
          name: '',
          objective: '',
          missions: [],
        },
      ],
    }));
  }, [updatePlan]);

  const updateMission = useCallback(
    (
      phaseIndex: number,
      missionIndex: number,
      field: keyof PlanMission,
      value: PlanMission[keyof PlanMission],
    ) => {
      updatePlan((prev) => {
        const phases = [...prev.phases];
        const missions = [...phases[phaseIndex].missions];
        missions[missionIndex] = { ...missions[missionIndex], [field]: value };
        phases[phaseIndex] = { ...phases[phaseIndex], missions };
        return { ...prev, phases };
      });
    },
    [updatePlan],
  );

  const deleteMission = useCallback(
    (phaseIndex: number, missionIndex: number) => {
      updatePlan((prev) => {
        const phases = [...prev.phases];
        const missions = phases[phaseIndex].missions.filter((_, i) => i !== missionIndex);
        phases[phaseIndex] = { ...phases[phaseIndex], missions };
        return { ...prev, phases };
      });
    },
    [updatePlan],
  );

  const addMission = useCallback(
    (phaseIndex: number) => {
      updatePlan((prev) => {
        const phases = [...prev.phases];
        const missions = [
          ...phases[phaseIndex].missions,
          {
            title: '',
            briefing: '',
            assetCodename: '',
            priority: 'normal' as MissionPriority,
            dependsOn: [],
          },
        ];
        phases[phaseIndex] = { ...phases[phaseIndex], missions };
        return { ...prev, phases };
      });
    },
    [updatePlan],
  );

  // -----------------------------------------------------------------------
  // Drag-and-drop handlers
  // -----------------------------------------------------------------------

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);

      // Case 1: dragging a phase
      const activePhaseIdx = parsePhaseId(activeIdStr);
      const overPhaseIdx = parsePhaseId(overIdStr);

      if (activePhaseIdx !== null && overPhaseIdx !== null) {
        updatePlan((prev) => ({
          ...prev,
          phases: arrayMove(prev.phases, activePhaseIdx, overPhaseIdx),
        }));
        return;
      }

      // Case 2: dragging a mission
      const activeMission = parseMissionId(activeIdStr);
      const overMission = parseMissionId(overIdStr);

      if (activeMission) {
        if (overMission) {
          // Mission dropped on another mission
          if (activeMission.phaseIndex === overMission.phaseIndex) {
            // Same phase — reorder
            updatePlan((prev) => {
              const phases = [...prev.phases];
              const missions = arrayMove(
                phases[activeMission.phaseIndex].missions,
                activeMission.missionIndex,
                overMission.missionIndex,
              );
              phases[activeMission.phaseIndex] = {
                ...phases[activeMission.phaseIndex],
                missions,
              };
              return { ...prev, phases };
            });
          } else {
            // Cross-phase — remove from source, insert into target
            updatePlan((prev) => {
              const phases = [...prev.phases];
              const sourceMissions = [...phases[activeMission.phaseIndex].missions];
              const [moved] = sourceMissions.splice(activeMission.missionIndex, 1);
              phases[activeMission.phaseIndex] = {
                ...phases[activeMission.phaseIndex],
                missions: sourceMissions,
              };

              const targetMissions = [...phases[overMission.phaseIndex].missions];
              targetMissions.splice(overMission.missionIndex, 0, moved);
              phases[overMission.phaseIndex] = {
                ...phases[overMission.phaseIndex],
                missions: targetMissions,
              };

              return { ...prev, phases };
            });
          }
        }
      }
    },
    [updatePlan],
  );

  // -----------------------------------------------------------------------
  // Save handler
  // -----------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateBattlePlan(campaignId, plan);
      setDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  }, [campaignId, plan]);

  // -----------------------------------------------------------------------
  // Determine what's being dragged for the overlay
  // -----------------------------------------------------------------------

  let dragOverlay: React.ReactNode = null;
  if (activeDragId) {
    const idStr = String(activeDragId);
    const pIdx = parsePhaseId(idStr);
    if (pIdx !== null && plan.phases[pIdx]) {
      dragOverlay = <PhaseOverlay phase={plan.phases[pIdx]} phaseIndex={pIdx} />;
    } else {
      const mParsed = parseMissionId(idStr);
      if (mParsed && plan.phases[mParsed.phaseIndex]?.missions[mParsed.missionIndex]) {
        dragOverlay = (
          <MissionOverlay
            mission={plan.phases[mParsed.phaseIndex].missions[mParsed.missionIndex]}
          />
        );
      }
    }
  }

  // Phase IDs for sortable context
  const phaseIds = plan.phases.map((_, i) => phaseId(i));

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="font-tactical text-sm text-dr-amber uppercase tracking-wider">
            BATTLE PLAN EDITOR
          </h2>
          {dirty && (
            <span className="font-tactical text-[10px] text-dr-amber animate-pulse uppercase tracking-wider">
              ● UNSAVED CHANGES
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saveError && (
            <span className="font-tactical text-xs text-dr-red">
              {saveError}
            </span>
          )}
          <TacButton
            onClick={handleSave}
            disabled={saving || !dirty}
            variant="success"
            size="sm"
          >
            {saving ? 'SAVING...' : 'SAVE PLAN'}
          </TacButton>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-dr-surface border border-dr-border p-4">
        <span className="text-[10px] text-dr-dim uppercase tracking-wider block mb-2">
          PLAN SUMMARY
        </span>
        <TacTextarea
          value={plan.summary}
          onChange={(e) => {
            setPlan((prev) => ({ ...prev, summary: e.target.value }));
            setDirty(true);
          }}
          placeholder="Campaign plan summary..."
          className="min-h-[60px] text-xs"
        />
      </div>

      {/* DnD Context wrapping phases and missions */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={phaseIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-4">
            {plan.phases.map((phase, pi) => (
              <SortablePhaseItem
                key={phaseId(pi)}
                id={phaseId(pi)}
                phase={phase}
                phaseIndex={pi}
                assets={assets}
                onUpdatePhase={(field, value) => updatePhase(pi, field, value)}
                onDeletePhase={() => deletePhase(pi)}
                onUpdateMission={(mi, field, value) =>
                  updateMission(pi, mi, field, value)
                }
                onDeleteMission={(mi) => deleteMission(pi, mi)}
                onAddMission={() => addMission(pi)}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {dragOverlay}
        </DragOverlay>
      </DndContext>

      {/* Add phase button */}
      <button
        onClick={addPhase}
        className={cn(
          'border border-dashed border-dr-border hover:border-dr-amber',
          'py-4 flex items-center justify-center',
          'text-dr-dim hover:text-dr-amber font-tactical text-xs uppercase tracking-wider',
          'transition-colors hover:bg-dr-amber/5',
        )}
      >
        + ADD PHASE
      </button>
    </div>
  );
}
