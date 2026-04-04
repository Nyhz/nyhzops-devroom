'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { TacCard } from '@/components/ui/tac-card';
import { TacButton } from '@/components/ui/tac-button';
import { cn } from '@/lib/utils';
import { getRecentExits, getExitContext } from '@/actions/telemetry';
import type { ExitEntry, FailureType } from '@/types';

type ExitFilter = 'all' | 'crashes' | 'timeouts' | 'killed';

interface RecentExitsProps {
  battlefieldId: string;
  initialExits: ExitEntry[];
  className?: string;
}

const FILTERS: { key: ExitFilter; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'crashes', label: 'CRASHES' },
  { key: 'timeouts', label: 'TIMEOUTS' },
  { key: 'killed', label: 'KILLED' },
];

function getExitBadge(entry: ExitEntry): { symbol: string; label: string; color: string } {
  if (entry.exitCode === 0) {
    return { symbol: '✓', label: '0', color: 'text-dr-green' };
  }
  if (entry.failureType === 'timeout') {
    return { symbol: '⏱', label: 'TIMEOUT', color: 'text-dr-amber' };
  }
  if (entry.failureType === 'killed' || entry.failureType === 'stall_killed') {
    return { symbol: '☠', label: 'KILLED', color: 'text-dr-red' };
  }
  return { symbol: '✗', label: `${entry.exitCode ?? 1}`, color: 'text-dr-red' };
}

const failureLabels: Record<FailureType, string> = {
  timeout: 'TIMEOUT',
  auth_failure: 'AUTH FAILURE',
  cli_error: 'CLI ERROR',
  stall_killed: 'STALL KILLED',
  killed: 'KILLED',
  unknown: 'UNKNOWN',
};

function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function filterToStatusParam(
  filter: ExitFilter,
): 'accomplished' | 'compromised' | 'abandoned' | undefined {
  if (filter === 'all') return undefined;
  if (filter === 'crashes') return 'compromised';
  if (filter === 'killed') return 'abandoned';
  // timeouts: we filter client-side from compromised
  return undefined;
}

function applyClientFilter(exits: ExitEntry[], filter: ExitFilter): ExitEntry[] {
  if (filter === 'timeouts') {
    return exits.filter((e) => e.failureType === 'timeout');
  }
  return exits;
}

interface ExitRowProps {
  entry: ExitEntry;
  battlefieldId: string;
}

function ExitRow({ entry, battlefieldId }: ExitRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [logLines, setLogLines] = useState<string[] | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);

  const badge = getExitBadge(entry);

  async function handleExpand() {
    if (!expanded && logLines === null) {
      setLoadingLog(true);
      try {
        const lines = await getExitContext(entry.missionId);
        setLogLines(lines);
      } finally {
        setLoadingLog(false);
      }
    }
    setExpanded((v) => !v);
  }

  return (
    <>
      <div
        className="flex flex-col gap-1.5 px-3 py-2 hover:bg-dr-elevated/30 cursor-pointer sm:flex-row sm:items-center sm:gap-3"
        onClick={handleExpand}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleExpand()}
      >
        {/* Mission link */}
        <Link
          href={`/battlefields/${battlefieldId}/missions/${entry.missionId}`}
          className="text-xs font-tactical text-dr-amber hover:text-dr-text truncate flex-1 min-w-0"
          onClick={(e) => e.stopPropagation()}
        >
          {entry.missionCodename}
        </Link>

        {/* Exit badge */}
        <span className={cn('text-xs font-mono font-bold shrink-0', badge.color)}>
          {badge.symbol} {badge.label}
        </span>

        {/* Failure type label */}
        {entry.failureType && (
          <span className="text-[10px] font-tactical text-dr-muted shrink-0">
            {failureLabels[entry.failureType]}
          </span>
        )}

        {/* Duration */}
        <span className="text-xs font-mono text-dr-dim shrink-0">
          {formatDuration(entry.duration)}
        </span>

        {/* Timestamp */}
        <span className="text-xs font-mono text-dr-dim shrink-0">
          {formatTimestamp(entry.timestamp)}
        </span>
      </div>

      {/* Expandable log context */}
      {expanded && (
        <div className="px-3 pb-3 border-b border-dr-border/50">
          {loadingLog ? (
            <div className="text-xs font-mono text-dr-dim animate-pulse py-2">
              Loading log context…
            </div>
          ) : logLines && logLines.length > 0 ? (
            <pre className="text-[10px] font-mono text-dr-muted bg-dr-bg border border-dr-border p-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto">
              {logLines.join('\n')}
            </pre>
          ) : (
            <span className="text-xs font-mono text-dr-dim">NO LOG DATA AVAILABLE</span>
          )}
        </div>
      )}
    </>
  );
}

export function RecentExits({ battlefieldId, initialExits, className }: RecentExitsProps) {
  const [filter, setFilter] = useState<ExitFilter>('all');
  const [exits, setExits] = useState<ExitEntry[]>(initialExits);
  const [isPending, startTransition] = useTransition();

  function handleFilterChange(newFilter: ExitFilter) {
    setFilter(newFilter);
    const statusParam = filterToStatusParam(newFilter);
    startTransition(async () => {
      const fresh = await getRecentExits(battlefieldId, statusParam);
      setExits(applyClientFilter(fresh, newFilter));
    });
  }

  const displayedExits = filter === 'timeouts' ? applyClientFilter(exits, filter) : exits;

  return (
    <TacCard className={cn('p-0', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-dr-border flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-dr-amber text-xs font-tactical tracking-wider">
          RECENT EXITS
        </span>
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map((f) => (
            <TacButton
              key={f.key}
              size="sm"
              variant={filter === f.key ? 'primary' : 'ghost'}
              disabled={isPending}
              onClick={() => handleFilterChange(f.key)}
            >
              {f.label}
            </TacButton>
          ))}
        </div>
      </div>

      {/* Exits list */}
      {displayedExits.length === 0 ? (
        <div className="px-3 py-4 text-dr-dim text-xs font-tactical">
          NO EXITS RECORDED
        </div>
      ) : (
        <div className="divide-y divide-dr-border/50">
          {displayedExits.map((entry) => (
            <ExitRow key={entry.missionId} entry={entry} battlefieldId={battlefieldId} />
          ))}
        </div>
      )}
    </TacCard>
  );
}
