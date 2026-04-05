'use client';

import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { TacTextarea } from '@/components/ui/tac-input';
import { InlineEdit } from './inline-edit';
import { PRIORITIES, priorityDotColor } from './plan-editor-utils';
import { MissionTypeBadge } from '@/components/mission/mission-type-badge';
import type { PlanMission, MissionPriority, MissionType } from '@/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SortableMissionItemProps {
  id: string;
  mission: PlanMission;
  missionIndex: number;
  phaseMissions: PlanMission[];
  assets: Array<{ id: string; codename: string; specialty: string }>;
  onUpdate: (field: keyof PlanMission, value: PlanMission[keyof PlanMission]) => void;
  onDelete: () => void;
}

// ---------------------------------------------------------------------------
// SortableMissionItem — draggable mission card within a phase
// ---------------------------------------------------------------------------

export function SortableMissionItem({
  id,
  mission,
  missionIndex,
  phaseMissions,
  assets,
  onUpdate,
  onDelete,
}: SortableMissionItemProps) {
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
  const currentType: MissionType = mission.type === 'verification' ? 'verification' : 'direct_action';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-dr-elevated border border-dr-border p-3 w-full md:min-w-[240px] md:max-w-[320px] flex flex-col gap-2 md:shrink-0',
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
          className={cn('mt-1.5 h-3 w-3 shrink-0 rounded-full', dotColor)}
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

      {/* Mission type toggle — segmented control (DIRECT ACTION / VERIFICATION) */}
      <div className="flex items-stretch border border-dr-border">
        <button
          type="button"
          onClick={() => onUpdate('type', 'direct_action')}
          className={cn(
            'flex-1 px-2 py-1 font-tactical text-[10px] uppercase tracking-wider transition-colors',
            currentType === 'direct_action'
              ? 'bg-dr-amber/15 text-dr-amber border-r border-dr-amber/50'
              : 'text-dr-dim hover:text-dr-amber border-r border-dr-border',
          )}
          title="Mutates code, must commit, will be merged"
        >
          <span aria-hidden="true">▣</span> DIRECT ACTION
        </button>
        <button
          type="button"
          onClick={() => onUpdate('type', 'verification')}
          className={cn(
            'flex-1 px-2 py-1 font-tactical text-[10px] uppercase tracking-wider transition-colors',
            currentType === 'verification'
              ? 'bg-dr-teal/15 text-dr-teal'
              : 'text-dr-dim hover:text-dr-teal',
          )}
          title="Read-only verification, no merge performed"
        >
          <span aria-hidden="true">◈</span> VERIFICATION
        </button>
      </div>

      {/* Briefing toggle */}
      <button
        onClick={() => setBriefingExpanded(!briefingExpanded)}
        className="text-left text-xs text-dr-muted uppercase tracking-wider hover:text-dr-text"
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
        <span className="text-xs text-dr-muted uppercase tracking-wider shrink-0">
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
        <span className="text-xs text-dr-muted uppercase tracking-wider shrink-0">
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
        <span className="text-xs text-dr-muted uppercase tracking-wider shrink-0">
          DEPS
        </span>
        {currentDeps.map((dep) => (
          <span
            key={dep}
            className="inline-flex items-center gap-1 bg-dr-bg border border-dr-border text-dr-muted text-xs px-1.5 py-0.5 font-tactical"
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
              <div className="absolute left-0 bottom-full mb-1 z-40 bg-dr-surface border border-dr-border p-1 min-w-[180px] max-h-[160px] overflow-y-auto">
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

export function MissionOverlay({ mission }: { mission: PlanMission }) {
  const dotColor = priorityDotColor[mission.priority] ?? 'bg-dr-muted';
  return (
    <div className="bg-dr-elevated border border-dr-amber p-3 min-w-[240px] max-w-[320px] shadow-glow-amber opacity-90">
      <div className="flex items-center gap-2">
        <span className="text-dr-amber text-sm">⠿</span>
        <span className="font-tactical text-sm text-dr-text truncate flex-1">
          {mission.title || '(untitled)'}
        </span>
        <span className={cn('h-3 w-3 shrink-0 rounded-full', dotColor)} />
      </div>
      <div className="flex items-center gap-2 pl-5 mt-1">
        <MissionTypeBadge type={mission.type} />
        {mission.assetCodename && (
          <span className="text-xs text-dr-muted font-tactical">
            {mission.assetCodename}
          </span>
        )}
      </div>
    </div>
  );
}
