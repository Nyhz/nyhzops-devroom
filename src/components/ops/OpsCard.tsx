import type { OpsStatus } from '@/lib/ops/types';

const healthColor = (s: OpsStatus): string =>
  s.state === 'running' ? 'bg-green-500' : s.state === 'unresponsive' ? 'bg-amber-500' : 'bg-red-500';

function formatUptime(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function OpsCard({
  status, selected, onClick,
}: { status: OpsStatus; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'border p-3 text-left font-mono w-[220px] h-[130px] flex flex-col gap-2 relative',
        selected
          ? 'border-amber-500 shadow-[inset_0_0_0_2px_rgba(245,158,11,0.2)]'
          : 'border-zinc-800 hover:border-zinc-600',
      ].join(' ')}
    >
      <div className="flex items-start justify-between">
        <span className="text-amber-500 text-sm tracking-widest">{status.displayName}</span>
        <span className={`w-2 h-2 rounded-full ${healthColor(status)}`} />
      </div>
      <div className="text-[10px] text-zinc-500 tracking-widest">
        {status.mode.toUpperCase()}{status.isSelfControlled ? ' • SELF' : ''}
      </div>
      <div className="mt-auto text-xs text-zinc-400 grid grid-cols-3 gap-1">
        <span>{formatUptime(status.uptimeMs)}</span>
        <span>{status.rssBytes ? `${Math.round(status.rssBytes / 1024 / 1024)}M` : '—'}</span>
        <span>{status.cpuPercent != null ? `${status.cpuPercent.toFixed(1)}%` : '—'}</span>
      </div>
    </button>
  );
}
