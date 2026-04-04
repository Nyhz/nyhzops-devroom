import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import type { ServiceHealthStatus } from '@/types';

interface ServiceHealthProps {
  health: ServiceHealthStatus;
  className?: string;
}

function formatTime(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRelative(ts: number | null): string {
  if (!ts) return '—';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface ServiceCardProps {
  title: string;
  dotColor: string;
  rows: { label: string; value: string }[];
}

function ServiceCard({ title, dotColor, rows }: ServiceCardProps) {
  return (
    <div className="bg-dr-bg border border-dr-border p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className={cn('text-sm leading-none', dotColor)}>●</span>
        <span className="text-xs font-tactical tracking-wider text-dr-text">{title}</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-tactical text-dr-dim">{row.label}</span>
          <span className="text-[10px] font-mono text-dr-muted text-right">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ServiceHealth({ health, className }: ServiceHealthProps) {
  const { scheduler, overseer, quartermaster, stallDetection } = health;

  const schedulerDot =
    scheduler.status === 'running' ? 'text-dr-green' : 'text-dr-red';

  const overseerDot =
    overseer.pendingReviews > 3 ? 'text-dr-amber' : 'text-dr-green';

  const quartermasterDot =
    quartermaster.pendingMerges > 3 ? 'text-dr-amber' : 'text-dr-green';

  const stallDot =
    stallDetection.count24h > 5
      ? 'text-dr-red'
      : stallDetection.count24h > 0
        ? 'text-dr-amber'
        : 'text-dr-green';

  return (
    <TacCard className={cn('p-0', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-dr-border">
        <span className="text-dr-amber text-xs font-tactical tracking-wider">
          BACKGROUND SERVICES
        </span>
      </div>

      {/* 2×2 grid */}
      <div className="grid grid-cols-1 gap-px bg-dr-border sm:grid-cols-2">
        <ServiceCard
          title="SCHEDULER"
          dotColor={schedulerDot}
          rows={[
            {
              label: 'STATUS',
              value: scheduler.status.toUpperCase(),
            },
            {
              label: 'LAST TICK',
              value: formatRelative(scheduler.lastTick),
            },
            {
              label: 'NEXT FIRE',
              value: formatTime(scheduler.nextFire),
            },
            {
              label: 'MISSED RUNS',
              value: `${scheduler.missedRuns}`,
            },
          ]}
        />

        <ServiceCard
          title="OVERSEER"
          dotColor={overseerDot}
          rows={[
            {
              label: 'PENDING REVIEWS',
              value: `${overseer.pendingReviews}`,
            },
            {
              label: 'LAST REVIEW',
              value: formatRelative(overseer.lastReview),
            },
          ]}
        />

        <ServiceCard
          title="QUARTERMASTER"
          dotColor={quartermasterDot}
          rows={[
            {
              label: 'PENDING MERGES',
              value: `${quartermaster.pendingMerges}`,
            },
            {
              label: 'LAST MERGE',
              value: formatRelative(quartermaster.lastMerge),
            },
          ]}
        />

        <ServiceCard
          title="STALL DETECTION"
          dotColor={stallDot}
          rows={[
            {
              label: 'STALLS (24H)',
              value: `${stallDetection.count24h}`,
            },
            {
              label: 'LAST STALL',
              value: stallDetection.lastStall
                ? formatRelative(stallDetection.lastStall.timestamp)
                : '—',
            },
            ...(stallDetection.lastStall
              ? [
                  {
                    label: 'MISSION',
                    value: stallDetection.lastStall.missionCodename,
                  },
                ]
              : []),
          ]}
        />
      </div>
    </TacCard>
  );
}
