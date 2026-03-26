import { cn } from '@/lib/utils';

interface TacBadgeProps {
  status: string;
  className?: string;
  glow?: boolean;
}

type StatusColor = 'green' | 'amber' | 'red' | 'blue' | 'dim';

const statusColorMap: Record<string, StatusColor> = {
  accomplished: 'green',
  secured: 'green',
  active: 'amber',
  in_combat: 'amber',
  deploying: 'amber',
  compromised: 'red',
  initializing: 'blue',
  queued: 'blue',
  standby: 'dim',
  draft: 'dim',
  offline: 'dim',
  abandoned: 'dim',
} as const;

const colorStyles: Record<StatusColor, string> = {
  green: 'text-dr-green',
  amber: 'text-dr-amber',
  red: 'text-dr-red',
  blue: 'text-dr-blue',
  dim: 'text-dr-dim',
} as const;

const glowStyles: Record<StatusColor, string> = {
  green: 'shadow-glow-green',
  amber: 'shadow-glow-amber',
  red: 'shadow-glow-red',
  blue: '',
  dim: '',
} as const;

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
