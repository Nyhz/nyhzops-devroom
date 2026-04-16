'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { toggleMainRedOverride } from '@/actions/battlefield';
import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';

interface MainRedOverrideToggleProps {
  battlefieldId: string;
  initialEnabled: boolean;
  className?: string;
}

export function MainRedOverrideToggle({
  battlefieldId,
  initialEnabled,
  className,
}: MainRedOverrideToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !enabled;
    startTransition(async () => {
      try {
        await toggleMainRedOverride(battlefieldId, next);
        setEnabled(next);
        if (next) {
          toast.warning('MAIN-RED OVERRIDE ENABLED — Operations may proceed with a failing main branch.');
        } else {
          toast.success('MAIN-RED OVERRIDE DISABLED — Main branch guard is active.');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`TOGGLE FAILED — ${msg}`);
      }
    });
  }

  return (
    <TacCard status={enabled ? 'red' : 'dim'} className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-tactical uppercase tracking-wider text-dr-amber">
          Main Branch Red Override
        </h2>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Main-red override toggle"
          onClick={handleToggle}
          disabled={isPending}
          className={cn(
            'relative w-12 h-6 border transition-all cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed',
            enabled
              ? 'bg-dr-red/20 border-dr-red'
              : 'bg-dr-bg border-dr-border',
          )}
        >
          <div
            className={cn(
              'absolute top-0.5 w-5 h-5 transition-all',
              enabled
                ? 'left-6 bg-dr-red'
                : 'left-0.5 bg-dr-dim',
            )}
          />
        </button>
      </div>

      <p className="text-xs font-data text-dr-muted">
        When enabled, the main branch red guard is bypassed. Missions may deploy even if the main branch is failing.
      </p>

      {enabled && (
        <div className="flex items-start gap-2 border border-dr-red/40 bg-dr-red/5 p-3">
          <span className="text-dr-red text-xs font-tactical uppercase tracking-wider">
            WARNING
          </span>
          <span className="text-xs font-data text-dr-red">
            Operations may proceed with a failing main branch. Disable this override when the branch is restored.
          </span>
        </div>
      )}
    </TacCard>
  );
}
