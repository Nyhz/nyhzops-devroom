import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import type { ResourceMetrics } from '@/types';

interface ResourceUsageProps {
  metrics: ResourceMetrics;
  className?: string;
}

type HealthLevel = 'green' | 'amber' | 'red';

const HEALTH_BG: Record<HealthLevel, string> = {
  green: 'bg-dr-green',
  amber: 'bg-dr-amber',
  red: 'bg-dr-red',
};

const HEALTH_TEXT: Record<HealthLevel, string> = {
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

function slotHealth(active: number, max: number): HealthLevel {
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

export function ResourceUsage({ metrics, className }: ResourceUsageProps) {
  const { agentSlots, worktreeDisk, tempDisk, dbSize, socketConnections } = metrics;

  const slotPct = agentSlots.max > 0
    ? Math.round((agentSlots.active / agentSlots.max) * 100)
    : 0;
  const sHealth = slotHealth(agentSlots.active, agentSlots.max);

  const diskItems: { label: string; value: string; health: HealthLevel }[] = [
    { label: 'WORKTREES', value: formatBytes(worktreeDisk), health: diskHealth(worktreeDisk, 500, 1024) },
    { label: 'TEMP', value: formatBytes(tempDisk), health: diskHealth(tempDisk, 200, 500) },
    { label: 'DATABASE', value: formatBytes(dbSize), health: diskHealth(dbSize, 50, 200) },
  ];

  return (
    <TacCard className={cn('p-0', className)}>
      <div className="px-3 py-2 border-b border-dr-border">
        <span className="text-dr-amber text-xs font-tactical tracking-wider">
          RESOURCE USAGE
        </span>
      </div>

      <div className="p-3 space-y-4">
        {/* Agent Slots — prominent bar */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs font-tactical text-dr-muted tracking-wider">AGENT SLOTS</span>
            <span className="text-sm font-mono text-dr-text">
              <span className={HEALTH_TEXT[sHealth]}>{agentSlots.active}</span>
              <span className="text-dr-dim"> / {agentSlots.max}</span>
            </span>
          </div>
          <div className="h-1.5 bg-dr-bg rounded-sm overflow-hidden">
            <div
              className={cn('h-full rounded-sm transition-all', HEALTH_BG[sHealth])}
              style={{ width: `${Math.min(slotPct, 100)}%` }}
            />
          </div>
          <div className="text-[10px] font-mono text-dr-dim mt-1">{slotPct}% utilized</div>
        </div>

        {/* Disk metrics */}
        <div className="grid grid-cols-3 gap-3">
          {diskItems.map(item => (
            <div key={item.label} className="bg-dr-bg border border-dr-border px-3 py-2">
              <span className="text-[10px] font-tactical text-dr-dim tracking-wider">{item.label}</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn('text-[8px] leading-none', HEALTH_TEXT[item.health])}>●</span>
                <span className={cn('text-sm font-mono', HEALTH_TEXT[item.health])}>{item.value}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Socket connections — simple inline */}
        <div className="flex items-center justify-between pt-2 border-t border-dr-border/50">
          <span className="text-xs font-tactical text-dr-muted tracking-wider">SOCKET.IO CONNECTIONS</span>
          <span className="text-sm font-mono text-dr-text">{socketConnections}</span>
        </div>
      </div>
    </TacCard>
  );
}
