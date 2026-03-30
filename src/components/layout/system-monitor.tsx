'use client';

import { useSystemMetrics } from '@/hooks/use-system-metrics';
import { cn } from '@/lib/utils';

function thresholdColor(percent: number): string {
  if (percent >= 85) return 'bg-dr-red';
  if (percent >= 60) return 'bg-dr-amber';
  return 'bg-dr-green';
}

function thresholdText(percent: number): string {
  if (percent >= 85) return 'text-dr-red';
  if (percent >= 60) return 'text-dr-amber';
  return 'text-dr-green';
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)}G`;
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)}M`;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function SystemMonitor() {
  const metrics = useSystemMetrics();

  if (!metrics) {
    return (
      <div className="flex items-center gap-2 text-dr-dim text-xs flex-1">
        <span className="text-dr-amber font-bold text-sm">SYS //</span>
        <span className="text-xs">CONNECTING...</span>
      </div>
    );
  }

  const criticalCores = metrics.cores.filter((c) => c >= 85).length;

  return (
    <div className="flex items-center gap-4 flex-1 min-w-0">
      <span className="text-dr-amber font-bold text-sm whitespace-nowrap">
        SYS //
      </span>

      {/* CPU — per-core vertical bars */}
      <div className="flex items-center gap-1.5">
        <span className="text-dr-dim text-xs">CPU</span>
        <div className="flex items-end gap-[2px] h-3.5">
          {metrics.cores.map((usage, i) => (
            <div
              key={i}
              className="w-[4px] bg-dr-elevated relative"
              style={{ height: '100%' }}
              title={`Core ${i}: ${usage}%`}
            >
              <div
                className={cn('absolute bottom-0 left-0 right-0', thresholdColor(usage))}
                style={{ height: `${Math.max(usage, 2)}%` }}
              />
            </div>
          ))}
        </div>
        {criticalCores > 0 && (
          <span className="text-dr-red text-xs font-bold animate-pulse">
            !{criticalCores}
          </span>
        )}
      </div>

      {/* RAM */}
      <div className="flex items-center gap-1.5">
        <span className="text-dr-dim text-xs">RAM</span>
        <div className="w-12 h-[5px] bg-dr-elevated overflow-hidden">
          <div
            className={thresholdColor(metrics.ram.percent)}
            style={{ width: `${metrics.ram.percent}%`, height: '100%' }}
          />
        </div>
        <span className={cn('text-xs', thresholdText(metrics.ram.percent))}>
          {formatBytes(metrics.ram.used)}
        </span>
      </div>

      {/* Disk */}
      <div className="flex items-center gap-1.5">
        <span className="text-dr-dim text-xs">DSK</span>
        <div className="w-12 h-[5px] bg-dr-elevated overflow-hidden">
          <div
            className={thresholdColor(metrics.disk.percent)}
            style={{ width: `${metrics.disk.percent}%`, height: '100%' }}
          />
        </div>
        <span className={cn('text-xs', thresholdText(metrics.disk.percent))}>
          {metrics.disk.percent}%
        </span>
      </div>

      {/* Separator */}
      <span className="text-dr-border">|</span>

      {/* Uptime */}
      <div className="flex items-center gap-1.5">
        <span className="text-dr-dim text-xs">UP</span>
        <span className="text-dr-text text-xs">{formatUptime(metrics.uptime)}</span>
      </div>

      {/* Separator */}
      <span className="text-dr-border">|</span>

      {/* Assets */}
      <div className="flex items-center gap-1.5">
        <span className="text-dr-dim text-xs">ASSETS</span>
        <span className={cn('text-xs', metrics.assets.active >= metrics.assets.max ? 'text-dr-amber' : 'text-dr-green')}>
          {metrics.assets.active}
        </span>
        <span className="text-dr-dim text-xs">/</span>
        <span className="text-dr-text text-xs">{metrics.assets.max}</span>
      </div>
    </div>
  );
}
