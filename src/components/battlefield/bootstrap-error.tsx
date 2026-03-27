'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { useConfirm } from '@/hooks/use-confirm';
import { regenerateBootstrap, abandonBootstrap } from '@/actions/battlefield';

interface BootstrapErrorProps {
  battlefieldId: string;
  codename: string;
  debrief: string;
  initialBriefing: string;
}

export function BootstrapError({
  battlefieldId,
  codename,
  debrief,
  initialBriefing,
}: BootstrapErrorProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [confirm, ConfirmDialog] = useConfirm();

  async function handleRetry() {
    setIsPending(true);
    try {
      await regenerateBootstrap(battlefieldId, initialBriefing);
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to retry bootstrap';
      toast.error(message);
    } finally {
      setIsPending(false);
    }
  }

  async function handleAbandon() {
    const result = await confirm({
      title: 'ABANDON BATTLEFIELD',
      description: 'This action is permanent and cannot be undone.',
      body: <p>This will delete the battlefield and all associated data.</p>,
      actions: [{ label: 'ABANDON', variant: 'danger' }],
    });
    if (result !== 0) return;
    setIsPending(true);
    try {
      await abandonBootstrap(battlefieldId);
      router.push('/');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to abandon bootstrap';
      toast.error(message);
      setIsPending(false);
    }
  }

  return (
    <div>
      <h1 className="text-dr-amber text-xl font-tactical tracking-wider">
        {codename} — BOOTSTRAP FAILED
      </h1>
      <p className="text-dr-dim text-sm mt-2">
        Intelligence generation encountered resistance.
      </p>
      {debrief && (
        <p className="text-dr-muted text-xs mt-1">{debrief}</p>
      )}

      <div className="flex gap-3 mt-6">
        <TacButton
          variant="primary"
          onClick={handleRetry}
          disabled={isPending}
        >
          RETRY BOOTSTRAP
        </TacButton>
        <TacButton
          variant="danger"
          onClick={handleAbandon}
          disabled={isPending}
        >
          ABANDON
        </TacButton>
      </div>

      <ConfirmDialog />
    </div>
  );
}
