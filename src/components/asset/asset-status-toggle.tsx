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
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={isActive}
        onClick={handleToggle}
        disabled={isPending}
        className={cn(
          'relative w-9 h-5 rounded-full transition-all duration-200 cursor-pointer',
          isActive
            ? 'bg-tac-green/30 shadow-[0_0_8px_rgba(0,255,0,0.2)]'
            : 'bg-dr-bg',
          'border',
          isActive ? 'border-tac-green/60' : 'border-dr-border',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200',
            isActive
              ? 'left-[18px] bg-tac-green shadow-[0_0_6px_rgba(0,255,0,0.6)]'
              : 'left-0.5 bg-dr-muted',
          )}
        />
      </button>
      <span className={cn(
        'font-mono text-xs uppercase tracking-wider',
        isActive ? 'text-tac-green' : 'text-dr-muted',
      )}>
        {isActive ? 'Active' : 'Offline'}
      </span>
    </div>
  );
}
