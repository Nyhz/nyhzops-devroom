'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { toggleAssetStatus } from '@/actions/asset';

interface AssetStatusToggleProps {
  assetId: string;
  status: string;
}

export function AssetStatusToggle({ assetId, status }: AssetStatusToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isActive = status === 'active';

  function handleToggle() {
    startTransition(async () => {
      try {
        await toggleAssetStatus(assetId);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to toggle status');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded font-mono text-xs uppercase tracking-wider transition-colors',
        isActive
          ? 'text-tac-green'
          : 'text-tac-red',
      )}
    >
      <span className={cn(
        'w-2 h-2 rounded-full',
        isActive
          ? 'bg-tac-green shadow-[0_0_6px_rgba(0,255,0,0.5)]'
          : 'bg-tac-red shadow-[0_0_6px_rgba(255,0,0,0.5)]',
      )} />
      {isActive ? 'Active' : 'Offline'}
    </button>
  );
}
