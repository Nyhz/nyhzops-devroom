'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { pruneForensicBranches } from '@/actions/battlefield';
import { TacCard } from '@/components/ui/tac-card';
import { TacInput } from '@/components/ui/tac-input';
import { TacButton } from '@/components/ui/tac-button';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';

interface ForensicPruneFormProps {
  battlefieldId: string;
  className?: string;
}

export function ForensicPruneForm({ battlefieldId, className }: ForensicPruneFormProps) {
  const [daysOld, setDaysOld] = useState(7);
  const [daysError, setDaysError] = useState('');
  const [pruneResult, setPruneResult] = useState<{ pruned: string[]; daysOld: number } | null>(null);

  const [isPending, startTransition] = useTransition();
  const [confirm, ConfirmDialog] = useConfirm();

  async function handlePrune() {
    setDaysError('');

    if (!Number.isInteger(daysOld) || daysOld < 1) {
      setDaysError('Days must be a positive integer.');
      return;
    }

    const choice = await confirm({
      title: 'PRUNE FORENSIC BRANCHES',
      description: `Delete all forensic/* branches older than ${daysOld} day${daysOld === 1 ? '' : 's'}. This action cannot be undone.`,
      actions: [{ label: 'PRUNE', variant: 'danger' }],
    });

    if (choice !== 0) return;

    startTransition(async () => {
      try {
        const result = await pruneForensicBranches(battlefieldId, daysOld);
        setPruneResult({ pruned: result.pruned, daysOld });
        if (result.pruned.length > 0) {
          toast.success(`FORENSIC PRUNE — Pruned ${result.pruned.length} branch${result.pruned.length === 1 ? '' : 'es'}.`);
        } else {
          toast.success(`FORENSIC PRUNE — No branches older than ${daysOld} days found.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`PRUNE FAILED — ${msg}`);
      }
    });
  }

  return (
    <TacCard status="dim" className={cn('space-y-4', className)}>
      <h2 className="text-sm font-tactical uppercase tracking-wider text-dr-amber">
        Forensic Branch Prune
      </h2>

      <p className="text-xs font-data text-dr-muted">
        Delete local <span className="font-tactical text-dr-text">forensic/*</span> branches older than the specified number of days. Destructive — cannot be undone.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label
            htmlFor="days-old"
            className="block text-xs font-tactical uppercase tracking-wider text-dr-muted"
          >
            Days Old
          </label>
          <TacInput
            id="days-old"
            type="number"
            min={1}
            value={daysOld}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              setDaysOld(isNaN(parsed) ? 1 : parsed);
              setDaysError('');
              setPruneResult(null);
            }}
            className="w-32"
            disabled={isPending}
          />
          {daysError && (
            <p className="text-xs font-data text-dr-red">{daysError}</p>
          )}
        </div>

        <TacButton
          variant="danger"
          size="sm"
          onClick={handlePrune}
          disabled={isPending}
        >
          {isPending ? 'PRUNING…' : 'Prune'}
        </TacButton>
      </div>

      {/* Prune result */}
      {pruneResult && (
        <div className="border border-dr-border bg-dr-bg p-3 space-y-1">
          {pruneResult.pruned.length > 0 ? (
            <>
              <p className="text-xs font-tactical uppercase tracking-wider text-dr-green">
                Pruned {pruneResult.pruned.length} branch{pruneResult.pruned.length === 1 ? '' : 'es'}:
              </p>
              <ul className="space-y-0.5">
                {pruneResult.pruned.map((b) => (
                  <li key={b} className="text-xs font-data text-dr-muted pl-2">
                    — {b}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs font-data text-dr-muted">
              No branches older than {pruneResult.daysOld} day{pruneResult.daysOld === 1 ? '' : 's'} found.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog />
    </TacCard>
  );
}
