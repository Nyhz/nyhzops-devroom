import { cn } from '@/lib/utils';

interface TelemetryHudProps {
  iterations: number | null;
  durationMs: number | null;
  costInput: number | null;
  costOutput: number | null;
  costCacheHit: number | null;
}

/** Format durations in a compact tactical way: `72s`, `4m 12s`, `1h 3m`. */
function formatDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (totalMin < 60) return sec ? `${totalMin}m ${sec}s` : `${totalMin}m`;
  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min ? `${hr}h ${min}m` : `${hr}h`;
}

/** 12345 → `12.3K`, 1_200_000 → `1.2M`. Small values kept exact. */
function formatTokens(n: number): string {
  if (n < 1000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

interface StatCellProps {
  label: string;
  value: string;
  sub?: string;
  accent: 'amber' | 'teal' | 'text' | 'green' | 'blue';
  last?: boolean;
}

function StatCell({ label, value, sub, accent, last }: StatCellProps) {
  const accentColor = {
    amber: 'bg-dr-amber',
    teal: 'bg-dr-teal',
    text: 'bg-dr-text/60',
    green: 'bg-dr-green',
    blue: 'bg-dr-blue',
  }[accent];
  const valueColor = {
    amber: 'text-dr-amber',
    teal: 'text-dr-teal',
    text: 'text-dr-text',
    green: 'text-dr-green',
    blue: 'text-dr-blue',
  }[accent];

  return (
    <div
      className={cn(
        'relative flex-1 min-w-0 px-3 py-3 sm:px-4 sm:py-3.5',
        !last && 'border-b sm:border-b-0 sm:border-r border-dr-border',
      )}
    >
      {/* top accent bar */}
      <div className={cn('absolute top-0 left-0 h-[2px] w-full', accentColor)} />
      <div className="text-dr-dim uppercase tracking-widest text-[10px] font-tactical">
        {label}
      </div>
      <div className={cn('mt-1 font-data text-lg sm:text-xl leading-none tabular-nums', valueColor)}>
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-dr-muted font-data text-[10px] tracking-wider">
          {sub}
        </div>
      )}
    </div>
  );
}

export function TelemetryHud({
  iterations,
  durationMs,
  costInput,
  costOutput,
  costCacheHit,
}: TelemetryHudProps) {
  const hasAny =
    (iterations && iterations > 0) ||
    (durationMs && durationMs > 0) ||
    (costInput && costInput > 0) ||
    (costOutput && costOutput > 0) ||
    (costCacheHit && costCacheHit > 0);
  if (!hasAny) return null;

  const input = costInput ?? 0;
  const output = costOutput ?? 0;
  const cache = costCacheHit ?? 0;
  const totalContext = input + cache;
  const cachePct = totalContext > 0 ? Math.round((cache / totalContext) * 100) : 0;

  return (
    <div className="flex flex-col sm:flex-row border border-dr-border bg-dr-surface overflow-hidden">
      <StatCell
        accent="amber"
        label="Iterations"
        value={(iterations ?? 0).toString()}
      />
      <StatCell
        accent="teal"
        label="Duration"
        value={durationMs && durationMs > 0 ? formatDuration(durationMs) : '—'}
      />
      <StatCell
        accent="text"
        label="Input"
        value={formatTokens(input)}
        sub={input > 0 ? `${input.toLocaleString()} tokens` : undefined}
      />
      <StatCell
        accent="green"
        label="Output"
        value={formatTokens(output)}
        sub={output > 0 ? `${output.toLocaleString()} tokens` : undefined}
      />
      <StatCell
        accent="blue"
        label="Cache Hit"
        value={formatTokens(cache)}
        sub={totalContext > 0 ? `${cachePct}% of context` : undefined}
        last
      />
    </div>
  );
}
