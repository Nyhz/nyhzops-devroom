'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacTextarea } from '@/components/ui/tac-input';
import { updateAsset } from '@/actions/asset';
import type { Asset } from '@/types';

interface AssetPromptTabProps {
  asset: Asset;
}

export function AssetPromptTab({ asset }: AssetPromptTabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [systemPrompt, setSystemPrompt] = useState(asset.systemPrompt ?? '');

  function handleSave() {
    startTransition(async () => {
      try {
        await updateAsset(asset.id, { systemPrompt });
        toast.success('System prompt updated');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update system prompt');
      }
    });
  }

  return (
    <div className="space-y-3">
      <TacTextarea
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder="Custom system prompt for this asset..."
        className="min-h-[400px] bg-dr-surface border-dr-border font-mono text-sm text-tac-dim"
      />
      <div className="flex items-center justify-between">
        <span className="text-dr-muted font-mono text-xs">
          {systemPrompt.length} characters
        </span>
        <TacButton
          type="button"
          variant="success"
          size="sm"
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? 'SAVING...' : 'SAVE PROMPT'}
        </TacButton>
      </div>
    </div>
  );
}
