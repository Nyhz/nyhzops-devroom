import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import type { ResourceMetrics } from '@/types';

interface ResourceUsageProps {
  metrics: ResourceMetrics;
  className?: string;
}

type HealthLevel = 'green' | 'amber' | 'red';

const healthDotColors: Record<HealthLevel, string> = {
  green: 'text-dr-green',
  amber: 'text-dr-amber',
  red: 'text-dr-red',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function agentSlotsHealth(active: number, max: number): HealthLevel {
  if (max === 0) return 'green';
  const pct = active / max;
  if (pct >= 1) return 'red';
  if (pct >= 0.8) return 'amber';
  return 'green';
}

function diskHealth(bytes: number, warnMb: number, critMb: number): HealthLevel {
  const mb = bytes / (1024 * 1024);
  if (mb > critMb) return 'red';
  if (mb > warnMb) return 'amber';
  return 'green';
}

interface StatCardProps {
  health: HealthLevel;
  value: string;
  label: string;
  sub?: string;
}

function StatCard({ health, value, label, sub }: StatCardProps) {
  return (
    <div className="bg-dr-surface px-4 py-3 flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className={cn('text-sm leading-none', healthDotColors[health])}>●</span>
        <span className="text-xs font-tactical text-dr-dim tracking-wider">{label}</span>
      </div>
      <span className="text-base font-mono text-dr-text font-semibold">{value}</span>
      {sub && <span className="text-[10px] font-mono text-dr-dim">{sub}</span>}
    </div>
  );
}

export function ResourceUsage({ metrics, className }: ResourceUsageProps) {
  const { agentSlots, worktreeDisk, tempDisk, dbSize, socketConnections } = metrics;

  const slotPct =
    agentSlots.max > 0
      ? Math.round((agentSlots.active / agentSlots.max) * 100)
      : 0;

  return (
    <TacCard className={cn('p-0', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-dr-border">
        <span className="text-dr-amber text-xs font-tactical tracking-wider">
          RESOURCE USAGE
        </span>
      </div>

      {/* Stats row */}
      <div className="flex gap-px bg-dr-border overflow-x-auto">
        <StatCard
          health={agentSlotsHealth(agentSlots.active, agentSlots.max)}
          value={`${agentSlots.active}/${agentSlots.max}`}
          label="AGENT SLOTS"
          sub={`${slotPct}% utilized`}
        />
        <StatCard
          health={diskHealth(worktreeDisk, 500, 1024)}
          value={formatBytes(worktreeDisk)}
          label="WORKTREE DISK"
        />
        <StatCard
          health={diskHealth(tempDisk, 200, 500)}
          value={formatBytes(tempDisk)}
          label="TEMP DISK"
        />
        <StatCard
          health={diskHealth(dbSize, 50, 200)}
          value={formatBytes(dbSize)}
          label="DB SIZE"
        />
        <StatCard
          health="green"
          value={`${socketConnections}`}
          label="SOCKET.IO"
          sub="connections"
        />
      </div>
    </TacCard>
  );
}
