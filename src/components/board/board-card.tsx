'use client';

import { cn, formatRelativeTime } from '@/lib/utils';
import type { IntelNoteWithMission } from '@/types';

// ---------------------------------------------------------------------------
// Status color maps
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  standby: 'border-l-dr-muted/40',
  queued: 'border-l-dr-muted/40',
  deploying: 'border-l-dr-amber/50',
  in_combat: 'border-l-dr-amber',
  reviewing: 'border-l-dr-blue/50',
  accomplished: 'border-l-dr-green/40',
  compromised: 'border-l-dr-red/40',
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  standby: 'text-dr-muted/60',
  queued: 'text-dr-muted/60',
  deploying: 'text-dr-amber/60',
  in_combat: 'text-dr-amber/70',
  reviewing: 'text-dr-blue/60',
  accomplished: 'text-dr-green/50',
  compromised: 'text-dr-red/50',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BoardCardProps {
  note: IntelNoteWithMission;
  isSelected: boolean;
  onSelect: (noteId: string) => void;
  onClick: (note: IntelNoteWithMission) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BoardCard({ note, isSelected, onSelect, onClick, className }: BoardCardProps) {
  const isLinked = note.missionId !== null;
  const isCampaignOnly = !isLinked && note.campaignId !== null;
  const isInCombat = note.missionStatus === 'in_combat';

  const status = note.missionStatus ?? 'standby';
  const borderColor = isLinked
    ? (STATUS_COLORS[status] ?? 'border-l-dr-muted/40')
    : 'border-l-white/20';

  const timeMs = note.missionCreatedAt ?? note.createdAt;

  return (
    <div
      className={cn(
        'group relative bg-dr-surface/50 border border-dr-border/50 border-l-2 px-3 py-2 cursor-pointer',
        'hover:bg-dr-surface/70 transition-colors',
        borderColor,
        className,
      )}
      onClick={() => onClick(note)}
    >
      {/* Checkbox — only for unpromoted notes (no missionId) */}
      {!isLinked && (
        <button
          type="button"
          className={cn(
            'absolute top-2 right-2 w-3.5 h-3.5 border flex items-center justify-center transition-opacity',
            'opacity-0 group-hover:opacity-100',
            isSelected
              ? 'border-dr-amber bg-dr-amber/20 opacity-100'
              : 'border-dr-border/60',
          )}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(note.id);
          }}
          aria-label="Select note"
        >
          {isSelected && (
            <span className="text-dr-amber text-[8px] leading-none">✓</span>
          )}
        </button>
      )}

      {/* Pulsing dot — in_combat missions only */}
      {isInCombat && (
        <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-dr-amber animate-pulse" />
      )}

      {/* Title */}
      <p
        className={cn(
          'font-mono leading-tight mb-1 pr-5 truncate',
          '[font-size:11px]',
          isLinked ? 'text-dr-text/80' : 'text-dr-text/70',
        )}
      >
        {note.title}
      </p>

      {/* Metadata line */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'font-mono truncate',
            '[font-size:10px]',
            isLinked
              ? (STATUS_TEXT_COLORS[status] ?? 'text-dr-muted/60')
              : 'text-dr-muted/50',
          )}
        >
          {isLinked ? (
            <>
              ↗{' '}
              <span className="uppercase">{status.replace('_', ' ')}</span>
              {note.missionAssetCodename && (
                <> · {note.missionAssetCodename}</>
              )}
            </>
          ) : isCampaignOnly ? (
            <span>⚑ Campaign</span>
          ) : (
            <span>Note</span>
          )}
        </span>

        <span className="font-mono text-dr-muted/40 shrink-0 [font-size:10px]">
          {formatRelativeTime(timeMs)}
        </span>
      </div>
    </div>
  );
}
