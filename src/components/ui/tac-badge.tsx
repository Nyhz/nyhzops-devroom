import { cn } from '@/lib/utils';

interface TacBadgeProps {
  status: string;
  className?: string;
  glow?: boolean;
}

export type StatusColor = 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'dim';

export const statusColorMap: Record<string, StatusColor> = {
  accomplished: 'green',
  secured: 'green',
  active: 'amber',
  in_combat: 'amber',
  deploying: 'amber',
  reviewing: 'blue',
  compromised: 'red',
  initializing: 'blue',
  queued: 'blue',
  standby: 'dim',
  draft: 'dim',
  offline: 'dim',
  abandoned: 'dim',
  approved: 'teal',
  merging: 'amber',
} as const;

const colorStyles: Record<StatusColor, string> = {
  green: 'text-dr-green',
  amber: 'text-dr-amber',
  red: 'text-dr-red',
  blue: 'text-dr-blue',
  teal: 'text-dr-teal',
  dim: 'text-dr-dim',
} as const;

const glowStyles: Record<StatusColor, string> = {
  green: 'shadow-glow-green',
  amber: 'shadow-glow-amber',
  red: 'shadow-glow-red',
  blue: '',
  teal: '',
  dim: '',
} as const;

const borderStyles: Record<StatusColor, string> = {
  green: 'border-l-dr-green',
  amber: 'border-l-dr-amber',
  red: 'border-l-dr-red',
  blue: 'border-l-dr-blue',
  teal: 'border-l-dr-teal',
  dim: 'border-l-dr-dim',
} as const;

export function getStatusColor(status: string): StatusColor {
  const normalized = status.toLowerCase().replace(/\s+/g, '_');
  return statusColorMap[normalized] ?? 'dim';
}

export function getStatusBorderColor(status: string | null): string {
  if (!status) return borderStyles.dim;
  return borderStyles[getStatusColor(status)];
}

export function TacBadge({ status, className, glow = false }: TacBadgeProps) {
  const normalizedStatus = status.toLowerCase().replace(/\s+/g, '_');
  const color = statusColorMap[normalizedStatus] ?? 'dim';
  const label = status.toUpperCase().replace(/_/g, ' ');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-tactical text-xs tracking-wider',
        colorStyles[color],
        glow && glowStyles[color],
        className,
      )}
    >
      <span aria-hidden="true">&bull;</span>
      {label}
    </span>
  );
}
