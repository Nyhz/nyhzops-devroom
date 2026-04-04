'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import type { QMLogEntry } from '@/types';

interface QuartermasterLogProps {
  entries: QMLogEntry[];
  battlefieldId: string;
  className?: string;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const resultConfig = {
  clean: {
    label: '✓ CLEAN',
    className: 'text-dr-green bg-dr-green/10 border-dr-green/30',
  },
  conflict_resolved: {
    label: '⚡ CONFLICT RESOLVED',
    className: 'text-dr-amber bg-dr-amber/10 border-dr-amber/30',
  },
  failed: {
    label: '✗ MERGE FAILED',
    className: 'text-dr-red bg-dr-red/10 border-dr-red/30',
  },
} as const;

export function QuartermasterLog({
  entries,
  battlefieldId,
  className,
}: QuartermasterLogProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <TacCard className={cn('p-0', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-dr-border">
        <span className="text-dr-amber text-xs font-tactical tracking-wider">
          QUARTERMASTER ACTIVITY
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="px-3 py-4 text-dr-dim text-xs font-tactical">
          NO MERGE ACTIVITY YET
        </div>
      ) : (
        <div className="divide-y divide-dr-border/50">
          {entries.map((entry) => {
            const cfg = resultConfig[entry.result];
            const isExpanded = expandedIds.has(entry.missionId);
            const isExpandable =
              entry.result === 'conflict_resolved' &&
              entry.conflictFiles.length > 0;

            return (
              <div key={entry.missionId}>
                <div
                  className={cn(
                    'flex flex-col gap-1.5 px-3 py-2 hover:bg-dr-elevated/30 sm:flex-row sm:items-center sm:gap-3',
                    isExpandable && 'cursor-pointer',
                  )}
                  onClick={isExpandable ? () => toggleExpanded(entry.missionId) : undefined}
                >
                  {/* Mission codename */}
                  <Link
                    href={`/battlefields/${battlefieldId}/missions/${entry.missionId}`}
                    className="text-xs font-tactical text-dr-amber hover:text-dr-text shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {entry.missionCodename}
                  </Link>

                  {/* Merge path */}
                  <span className="text-xs font-mono text-dr-muted flex-1 min-w-0 truncate">
                    <span className="text-dr-text">{entry.sourceBranch}</span>
                    <span className="text-dr-dim mx-1">→</span>
                    <span className="text-dr-text">{entry.targetBranch}</span>
                  </span>

                  {/* Result badge */}
                  <span
                    className={cn(
                      'text-xs font-tactical tracking-wide px-2 py-0.5 border shrink-0',
                      cfg.className,
                    )}
                  >
                    {cfg.label}
                  </span>

                  {/* Timestamp */}
                  <span className="text-xs font-mono text-dr-dim shrink-0">
                    {entry.timestamp ? formatTime(entry.timestamp) : '—'}
                  </span>

                  {/* Expand indicator */}
                  {isExpandable && (
                    <span className="text-xs text-dr-dim shrink-0">
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  )}
                </div>

                {/* Expanded: conflict files */}
                {isExpanded && entry.conflictFiles.length > 0 && (
                  <div className="px-3 py-2 bg-dr-bg border-t border-dr-border/50">
                    <div className="text-dr-dim text-xs font-tactical mb-1.5">
                      CONFLICTED FILES
                    </div>
                    <ul className="space-y-0.5">
                      {entry.conflictFiles.map((file) => (
                        <li key={file} className="text-xs font-mono text-dr-muted">
                          {file}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </TacCard>
  );
}
