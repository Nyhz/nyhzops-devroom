import type { OpsStatus } from '@/lib/ops/types';

function ledClass(s: OpsStatus): string {
  if (s.state === 'running') return 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.9)]';
  if (s.state === 'unresponsive') return 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.9)]';
  return 'bg-zinc-700';
}

function formatUptime(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d${h}h`;
  if (h) return `${h}h${m}m`;
  return `${m}m`;
}

export function OpsCard({
  status, selected, onClick,
}: { status: OpsStatus; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'relative border p-3 text-left font-mono w-[200px] h-[96px] flex flex-col gap-1.5 transition-all',
        selected
          ? 'border-amber-500 bg-amber-500/5 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.4),0_0_24px_-6px_rgba(245,158,11,0.5)]'
          : 'border-zinc-800 hover:border-zinc-600 bg-zinc-950/40',
      ].join(' ')}
    >
      {selected && (
        <>
          <span className="absolute -top-px -left-px w-2 h-2 border-t-2 border-l-2 border-amber-400" />
          <span className="absolute -top-px -right-px w-2 h-2 border-t-2 border-r-2 border-amber-400" />
          <span className="absolute -bottom-px -left-px w-2 h-2 border-b-2 border-l-2 border-amber-400" />
          <span className="absolute -bottom-px -right-px w-2 h-2 border-b-2 border-r-2 border-amber-400" />
        </>
      )}
      <div className="flex items-center justify-between">
        <span className={`text-sm tracking-[0.2em] ${selected ? 'text-amber-400' : 'text-amber-500/80'}`}>
          {status.displayName}
        </span>
        <span className={`w-2 h-2 rounded-full ${ledClass(status)}`} />
      </div>
      <div className="text-[9px] text-zinc-500 tracking-[0.25em]">
        {status.mode.toUpperCase()}{status.isSelfControlled ? ' · SELF' : ''}
      </div>
      <div className="mt-auto flex items-center justify-between text-[10px] text-zinc-400 tabular-nums">
        <span className="tracking-wider">UP {formatUptime(status.uptimeMs)}</span>
        <span className={
          status.httpCode == null ? 'text-zinc-600' :
          status.httpCode >= 500 ? 'text-red-400' :
          status.httpCode >= 400 ? 'text-amber-400' : 'text-green-400'
        }>
          HTTP {status.httpCode ?? '—'}
        </span>
      </div>
    </button>
  );
}
