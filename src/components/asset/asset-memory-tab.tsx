'use client';

import { useState, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacInput } from '@/components/ui/tac-input';
import { TacButton } from '@/components/ui/tac-button';
import { updateAssetMemory } from '@/actions/asset';
import { cn } from '@/lib/utils';
import type { Asset } from '@/types';

const MAX_ENTRIES = 15;

interface AssetMemoryTabProps {
  asset: Asset;
}

function parseMemory(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

export function AssetMemoryTab({ asset }: AssetMemoryTabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [entries, setEntries] = useState<string[]>(() => parseMemory(asset.memory));
  const [original] = useState<string[]>(() => parseMemory(asset.memory));
  const newEntryRef = useRef<HTMLInputElement>(null);

  const count = entries.length;
  const atCap = count >= MAX_ENTRIES;
  const nearCap = count >= 13;

  function handleAdd() {
    if (atCap) return;
    setEntries((prev) => [...prev, '']);
    // Focus the new input after render
    setTimeout(() => newEntryRef.current?.focus(), 0);
  }

  function handleUpdate(index: number, value: string) {
    setEntries((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleRemove(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave() {
    startTransition(async () => {
      try {
        // Clear existing and set new — simple full replace
        await updateAssetMemory(asset.id, {
          remove: Array.from({ length: original.length }, (_, i) => i),
          add: entries.filter((e) => e.trim().length > 0),
        });

        toast.success('Memory updated');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update memory');
      }
    });
  }

  const hasChanges = JSON.stringify(entries) !== JSON.stringify(original);

  return (
    <div className="space-y-4">
      {/* Counter */}
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'font-tactical text-xs uppercase tracking-widest',
            atCap ? 'text-red-500' : nearCap ? 'text-dr-amber' : 'text-dr-muted',
          )}
        >
          {count} / {MAX_ENTRIES} ENTRIES
        </span>
      </div>

      {/* Entry list */}
      {entries.length === 0 ? (
        <div className="border border-dr-border bg-dr-surface px-4 py-8 text-center">
          <p className="text-dr-muted font-tactical text-xs tracking-wider">
            No memories recorded. This asset will accumulate lessons from missions automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <TacInput
                ref={index === entries.length - 1 ? newEntryRef : undefined}
                value={entry}
                onChange={(e) => handleUpdate(index, e.target.value)}
                placeholder="Memory entry..."
                className="flex-1 bg-dr-surface text-sm py-2"
              />
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className={cn(
                  'shrink-0 w-9 h-9 flex items-center justify-center',
                  'font-tactical text-sm text-dr-muted hover:text-red-500',
                  'border border-dr-border hover:border-red-500/50 bg-dr-surface',
                  'transition-colors min-h-[44px] min-w-[44px]',
                )}
                aria-label={`Remove entry ${index + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-dr-border">
        <TacButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleAdd}
          disabled={atCap}
        >
          + ADD ENTRY
        </TacButton>
        <TacButton
          type="button"
          variant="success"
          size="sm"
          onClick={handleSave}
          disabled={isPending || !hasChanges}
        >
          {isPending ? 'SAVING...' : 'SAVE'}
        </TacButton>
      </div>
    </div>
  );
}
