'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TacCard } from '@/components/ui/tac-card';
import { TacButton } from '@/components/ui/tac-button';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/hooks/use-confirm';
import { deleteBranch, pruneAllMerged } from '@/actions/field-check';
import type { BranchStats, ProblemBranch } from '@/types';

interface BranchHygieneProps {
  battlefieldId: string;
  initialData: { stats: BranchStats; problems: ProblemBranch[] };
  className?: string;
}

function formatAge(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function BranchHygiene({
  battlefieldId,
  initialData,
  className,
}: BranchHygieneProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, ConfirmDialog] = useConfirm();

  const { stats, problems } = initialData;
  const mergedCount = problems.filter((p) => p.problem === 'merged').length;

  function runAction(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  async function handleDelete(branch: string) {
    const result = await confirm({
      title: 'DELETE BRANCH',
      description: `Delete branch "${branch}"? This cannot be undone.`,
      actions: [{ label: 'DELETE', variant: 'danger' }],
    });
    if (result !== 0) return;
    runAction(() => deleteBranch(battlefieldId, branch));
  }

  async function handlePruneAll() {
    const result = await confirm({
      title: 'PRUNE MERGED BRANCHES',
      description: `Delete all ${mergedCount} merged branches? This cannot be undone.`,
      actions: [{ label: 'PRUNE ALL', variant: 'danger' }],
    });
    if (result !== 0) return;
    runAction(() => pruneAllMerged(battlefieldId));
  }

  return (
    <TacCard className={cn('p-0', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-dr-border flex items-center justify-between gap-2">
        <span className="text-dr-amber text-xs font-tactical tracking-wider">
          BRANCH HYGIENE
        </span>
        {mergedCount > 0 && (
          <TacButton
            size="sm"
            variant="danger"
            disabled={isPending}
            onClick={handlePruneAll}
          >
            PRUNE MERGED ({mergedCount})
          </TacButton>
        )}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-px border-b border-dr-border bg-dr-border">
        {[
          { label: 'TOTAL', value: stats.total },
          { label: 'MERGED', value: stats.merged },
          { label: 'UNMERGED', value: stats.unmerged },
          { label: 'ACTIVE', value: stats.active },
        ].map(({ label, value }) => (
          <div key={label} className="bg-dr-surface px-4 py-3">
            <div className="text-dr-dim text-xs font-tactical tracking-wider">{label}</div>
            <div className="text-dr-text text-lg font-mono font-semibold mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {/* Problem list */}
      {problems.length === 0 ? (
        <div className="px-3 py-4 text-dr-green text-xs font-tactical tracking-wider">
          ✓ ALL BRANCHES CLEAN
        </div>
      ) : (
        <div className="divide-y divide-dr-border/50">
          {problems.map((p) => (
            <div
              key={p.name}
              className="flex flex-col gap-1.5 px-3 py-2 hover:bg-dr-elevated/30 sm:flex-row sm:items-center sm:gap-3"
            >
              {/* Branch name */}
              <span className="text-xs font-mono text-dr-text truncate flex-1 min-w-0">
                {p.name}
              </span>

              {/* Problem description */}
              <span
                className={cn(
                  'text-xs font-tactical tracking-wide shrink-0',
                  p.problem === 'merged' ? 'text-dr-green' : 'text-dr-amber',
                )}
              >
                {p.problem === 'merged'
                  ? 'MERGED — SAFE TO DELETE'
                  : `DIVERGED — ${p.ahead ?? 0} ahead, ${p.behind ?? 0} behind`}
              </span>

              {/* Age */}
              <span className="text-xs font-mono text-dr-dim shrink-0">
                {formatAge(p.lastCommitAge)}
              </span>

              {/* Delete button */}
              <TacButton
                size="sm"
                variant="danger"
                disabled={isPending}
                onClick={() => handleDelete(p.name)}
              >
                DELETE
              </TacButton>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog />
    </TacCard>
  );
}
