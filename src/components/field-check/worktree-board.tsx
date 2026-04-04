'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TacCard } from '@/components/ui/tac-card';
import { TacButton } from '@/components/ui/tac-button';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/hooks/use-confirm';
import { cleanupWorktree, cleanupAllStale } from '@/actions/field-check';
import type { WorktreeEntry } from '@/types';

interface WorktreeBoardProps {
  battlefieldId: string;
  initialWorktrees: WorktreeEntry[];
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAge(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const stateConfig = {
  active: { label: 'ACTIVE', color: 'text-dr-green' },
  stale: { label: 'STALE', color: 'text-dr-amber' },
  orphaned: { label: 'ORPHANED', color: 'text-dr-red' },
} as const;

export function WorktreeBoard({
  battlefieldId,
  initialWorktrees,
  className,
}: WorktreeBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, ConfirmDialog] = useConfirm();

  const staleCount = initialWorktrees.filter(
    (wt) => wt.state === 'stale' || wt.state === 'orphaned',
  ).length;

  function runAction(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  async function handleCleanup(wt: WorktreeEntry) {
    const result = await confirm({
      title: 'CLEANUP WORKTREE',
      description: `Remove worktree for branch "${wt.branch}"? This will delete the working directory.`,
      actions: [{ label: 'CLEANUP', variant: 'danger' }],
    });
    if (result !== 0) return;
    runAction(() => cleanupWorktree(battlefieldId, wt.path, wt.branch));
  }

  async function handleCleanupAll() {
    const result = await confirm({
      title: 'CLEANUP ALL STALE',
      description: `Remove all ${staleCount} stale and orphaned worktrees? This cannot be undone.`,
      actions: [{ label: 'CLEANUP ALL', variant: 'danger' }],
    });
    if (result !== 0) return;
    runAction(() => cleanupAllStale(battlefieldId));
  }

  return (
    <TacCard className={cn('p-0', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-dr-border flex items-center justify-between gap-2">
        <span className="text-dr-amber text-xs font-tactical tracking-wider">
          WORKTREE STATUS
        </span>
        {staleCount > 0 && (
          <TacButton
            size="sm"
            variant="danger"
            disabled={isPending}
            onClick={handleCleanupAll}
          >
            CLEANUP ALL STALE ({staleCount})
          </TacButton>
        )}
      </div>

      {initialWorktrees.length === 0 ? (
        <div className="px-3 py-4 text-dr-dim text-xs font-tactical">
          NO WORKTREES — All clean.
        </div>
      ) : (
        <div className="divide-y divide-dr-border/50">
          {initialWorktrees.map((wt) => {
            const cfg = stateConfig[wt.state];
            return (
              <div
                key={wt.path}
                className="flex flex-col gap-1.5 px-3 py-2 hover:bg-dr-elevated/30 sm:flex-row sm:items-center sm:gap-3"
              >
                {/* State indicator */}
                <span className={cn('text-sm shrink-0 font-tactical', cfg.color)}>
                  ●{' '}
                  <span className="text-xs">{cfg.label}</span>
                </span>

                {/* Branch name */}
                <span className="text-xs font-mono text-dr-text truncate flex-1 min-w-0">
                  {wt.branch}
                </span>

                {/* Linked mission */}
                {wt.linkedMission ? (
                  <Link
                    href={`/battlefields/${battlefieldId}/missions/${wt.linkedMission.id}`}
                    className="text-xs font-tactical text-dr-amber hover:text-dr-text truncate max-w-[160px] shrink-0"
                  >
                    {wt.linkedMission.codename}
                  </Link>
                ) : (
                  <span className="text-xs font-tactical text-dr-dim shrink-0">
                    NO MISSION
                  </span>
                )}

                {/* Age */}
                <span className="text-xs font-mono text-dr-muted shrink-0">
                  {formatAge(wt.age)}
                </span>

                {/* Disk usage */}
                <span className="text-xs font-mono text-dr-dim shrink-0">
                  {formatBytes(wt.diskUsage)}
                </span>

                {/* Cleanup button */}
                {wt.state !== 'active' && (
                  <TacButton
                    size="sm"
                    variant="danger"
                    disabled={isPending}
                    onClick={() => handleCleanup(wt)}
                  >
                    CLEANUP
                  </TacButton>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog />
    </TacCard>
  );
}
