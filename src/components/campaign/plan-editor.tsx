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
  arrayMove,
} from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { TacButton } from '@/components/ui/tac-button';
import { TacCard } from '@/components/ui/tac-card';
import { TacTextarea } from '@/components/ui/tac-input';
import { updateBattlePlan } from '@/actions/campaign-plan';
import { phaseId, parseMissionId, parsePhaseId } from './plan-editor/plan-editor-utils';
import { SortablePhaseItem } from './plan-editor/sortable-phase-item';
import { PhaseOverlay } from './plan-editor/sortable-phase-item';
import { MissionOverlay } from './plan-editor/sortable-mission-item';
import type { PlanJSON, PlanPhase, PlanMission, MissionPriority } from '@/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PlanEditorProps {
  campaignId: string;
  initialPlan: PlanJSON;
  assets: Array<{ id: string; codename: string; specialty: string }>;
}

// ---------------------------------------------------------------------------
// PlanEditor — main component
// ---------------------------------------------------------------------------

export function PlanEditor({
  campaignId,
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
            priority: 'routine' as MissionPriority,
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
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-4">
        <div className="flex items-center gap-3">
          <h2 className="font-tactical text-sm text-dr-amber uppercase tracking-wider">
            BATTLE PLAN EDITOR
          </h2>
          {dirty && (
            <span className="font-tactical text-xs text-dr-amber animate-pulse uppercase tracking-wider">
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
      <TacCard className="p-4">
        <span className="text-xs text-dr-muted uppercase tracking-wider block mb-2">
          PLAN SUMMARY
        </span>
        <TacTextarea
          value={plan.summary}
          onChange={(e) => {
            setPlan((prev) => ({ ...prev, summary: e.target.value }));
            setDirty(true);
          }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = target.scrollHeight + 'px';
          }}
          placeholder="Campaign plan summary..."
          className="min-h-0 text-xs resize-none overflow-hidden"
          rows={1}
        />
      </TacCard>

      {/* DnD Context wrapping phases and missions */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={phaseIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-4 touch-manipulation">
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
