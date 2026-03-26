'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import { cn } from '@/lib/utils';
import { checkoutBranch, deleteBranch, createBranch } from '@/actions/git';
import type { GitBranchesResult } from '@/types';

interface GitBranchesProps {
  battlefieldId: string;
  initialBranches: GitBranchesResult;
  className?: string;
}

export function GitBranches({ battlefieldId, initialBranches, className }: GitBranchesProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newBranchName, setNewBranchName] = useState('');

  const { current, local } = initialBranches;

  function runAction(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  function handleCheckout(branch: string) {
    runAction(() => checkoutBranch(battlefieldId, branch));
  }

  function handleDelete(branch: string) {
    if (!confirm(`Delete branch "${branch}"? This cannot be undone.`)) return;
    runAction(() => deleteBranch(battlefieldId, branch));
  }

  function handleCreate() {
    const name = newBranchName.trim();
    if (!name) return;
    startTransition(async () => {
      await createBranch(battlefieldId, name);
      setNewBranchName('');
      router.refresh();
    });
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* New branch form */}
      <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
        <div className="text-dr-amber text-xs font-tactical tracking-wider">NEW BRANCH</div>
        <div className="flex items-center gap-2">
          <TacInput
            placeholder="Branch name..."
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreate();
              }
            }}
            disabled={isPending}
            className="flex-1"
          />
          <TacButton
            size="sm"
            variant="success"
            disabled={isPending || !newBranchName.trim()}
            onClick={handleCreate}
          >
            Create
          </TacButton>
        </div>
      </div>

      {/* Local branches */}
      <div className="bg-dr-surface border border-dr-border">
        <div className="px-3 py-2 border-b border-dr-border">
          <span className="text-dr-amber text-xs font-tactical tracking-wider">
            LOCAL BRANCHES
          </span>
          <span className="text-dr-dim text-xs font-tactical ml-2">{local.length}</span>
        </div>
        {local.length === 0 ? (
          <div className="text-dr-dim text-xs font-tactical px-3 py-2">No local branches</div>
        ) : (
          local.map((branch) => {
            const isCurrent = branch.name === current;
            return (
              <div
                key={branch.name}
                className="flex items-center justify-between px-3 py-2 border-b border-dr-border/50 last:border-b-0 hover:bg-dr-elevated/50"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className={cn(
                      'text-sm shrink-0',
                      isCurrent ? 'text-dr-green' : 'text-dr-dim',
                    )}
                  >
                    {isCurrent ? '\u25CF' : '\u25CB'}
                  </span>
                  <span
                    className={cn(
                      'text-xs font-data truncate',
                      isCurrent ? 'text-dr-green' : 'text-dr-text',
                    )}
                  >
                    {branch.name}
                  </span>
                  {isCurrent && (
                    <span className="text-dr-green text-xs font-tactical tracking-wider">
                      CURRENT
                    </span>
                  )}
                </div>
                {!isCurrent && (
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <TacButton
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleCheckout(branch.name)}
                    >
                      Checkout
                    </TacButton>
                    <TacButton
                      size="sm"
                      variant="danger"
                      disabled={isPending}
                      onClick={() => handleDelete(branch.name)}
                    >
                      Delete
                    </TacButton>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
