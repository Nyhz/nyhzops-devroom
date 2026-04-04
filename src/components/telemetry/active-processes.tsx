'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TacCard } from '@/components/ui/tac-card';
import { TacButton } from '@/components/ui/tac-button';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/hooks/use-confirm';
import {
  killProcess,
  killAllProcesses,
} from '@/actions/telemetry';
import type { ProcessEntry, MissionStatus } from '@/types';

interface ActiveProcessesProps {
  battlefieldId: string;
  initialProcesses: ProcessEntry[];
  className?: string;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  deploying: { label: 'DEPLOYING', color: 'text-dr-amber' },
  in_combat: { label: 'IN COMBAT', color: 'text-dr-amber' },
  reviewing: { label: 'REVIEWING', color: 'text-dr-blue' },
};

function formatRuntime(startedAt: number | null): string {
  if (!startedAt) return '—';
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function RuntimeCounter({ startedAt }: { startedAt: number | null }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return <span className="text-xs font-mono text-dr-muted tabular-nums">{formatRuntime(startedAt)}</span>;
}

export function ActiveProcesses({
  battlefieldId,
  initialProcesses,
  className,
}: ActiveProcessesProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, ConfirmDialog] = useConfirm();

  function runAction(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  async function handleKill(proc: ProcessEntry) {
    const result = await confirm({
      title: 'KILL PROCESS',
      description: `Terminate mission "${proc.missionCodename}"? The process will be abandoned.`,
      actions: [{ label: 'KILL', variant: 'danger' }],
    });
    if (result !== 0) return;
    runAction(() => killProcess(battlefieldId, proc.missionId));
  }

  async function handleKillAll() {
    const result = await confirm({
      title: 'KILL ALL PROCESSES',
      description: `Terminate all ${initialProcesses.length} active process(es)? This cannot be undone.`,
      actions: [{ label: 'KILL ALL', variant: 'danger' }],
    });
    if (result !== 0) return;
    runAction(() => killAllProcesses(battlefieldId));
  }

  return (
    <TacCard className={cn('p-0', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-dr-border flex items-center justify-between gap-2">
        <span className="text-dr-amber text-xs font-tactical tracking-wider">
          ACTIVE PROCESSES
        </span>
        {initialProcesses.length > 0 && (
          <TacButton
            size="sm"
            variant="danger"
            disabled={isPending}
            onClick={handleKillAll}
          >
            KILL ALL ({initialProcesses.length})
          </TacButton>
        )}
      </div>

      {/* Process list */}
      {initialProcesses.length === 0 ? (
        <div className="px-3 py-4 text-dr-dim text-xs font-tactical">
          NO ACTIVE PROCESSES
        </div>
      ) : (
        <div className="divide-y divide-dr-border/50">
          {initialProcesses.map((proc) => {
            const cfg = statusConfig[proc.status as string] ?? {
              label: proc.status.toUpperCase(),
              color: 'text-dr-muted',
            };
            return (
              <div
                key={proc.missionId}
                className="flex flex-col gap-1.5 px-3 py-2 hover:bg-dr-elevated/30 sm:flex-row sm:items-center sm:gap-3"
              >
                {/* Mission link */}
                <Link
                  href={`/battlefields/${battlefieldId}/missions/${proc.missionId}`}
                  className="text-xs font-tactical text-dr-amber hover:text-dr-text truncate flex-1 min-w-0"
                >
                  {proc.missionCodename}
                </Link>

                {/* Asset */}
                <span className="text-xs font-mono text-dr-muted shrink-0 truncate max-w-[120px]">
                  {proc.asset}
                </span>

                {/* Status badge */}
                <span className={cn('text-xs font-tactical shrink-0', cfg.color)}>
                  {cfg.label}
                </span>

                {/* Runtime counter */}
                <RuntimeCounter startedAt={proc.startedAt} />

                {/* Kill button */}
                <TacButton
                  size="sm"
                  variant="danger"
                  disabled={isPending}
                  onClick={() => handleKill(proc)}
                >
                  KILL
                </TacButton>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog />
    </TacCard>
  );
}
