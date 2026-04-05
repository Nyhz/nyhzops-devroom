import { cn } from '@/lib/utils';
import type { MissionType } from '@/types';

// ---------------------------------------------------------------------------
// MissionTypeBadge — compact tactical badge distinguishing direct_action
// missions (mutating, merged) from verification missions (read-only, no merge).
// Styled to match the tactical theme: bordered, uppercase, monospaced, with
// an amber accent for direct_action and a teal accent for verification so the
// two modes are visually distinct at a glance without clashing with status
// colors (green/amber/red/blue/dim already used by TacBadge).
//
// Only the commander-facing types (direct_action, verification) are rendered;
// internal types (bootstrap, conflict_resolution, phase_debrief) render as
// direct_action by default since they are operational details the Commander
// does not interact with on the mission detail page.
// ---------------------------------------------------------------------------

interface MissionTypeBadgeProps {
  type: MissionType | null | undefined;
  className?: string;
  size?: 'sm' | 'md';
}

type DisplayKind = 'direct_action' | 'verification';

const styles: Record<DisplayKind, { label: string; glyph: string; color: string; border: string }> = {
  direct_action: {
    label: 'DIRECT ACTION',
    glyph: '▣',
    color: 'text-dr-amber',
    border: 'border-dr-amber/50',
  },
  verification: {
    label: 'VERIFICATION',
    glyph: '◈',
    color: 'text-dr-teal',
    border: 'border-dr-teal/50',
  },
};

export function MissionTypeBadge({ type, className, size = 'sm' }: MissionTypeBadgeProps) {
  const kind: DisplayKind = type === 'verification' ? 'verification' : 'direct_action';
  const style = styles[kind];
  const padding = size === 'md' ? 'px-2 py-0.5' : 'px-1.5 py-0.5';
  const text = size === 'md' ? 'text-xs' : 'text-[10px]';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border font-tactical tracking-wider uppercase',
        padding,
        text,
        style.color,
        style.border,
        className,
      )}
      title={kind === 'verification' ? 'Verification mission — read-only, no merge' : 'Direct action mission — modifies code, merges on success'}
    >
      <span aria-hidden="true">{style.glyph}</span>
      {style.label}
    </span>
  );
}
