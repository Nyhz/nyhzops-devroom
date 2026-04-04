"use client";

import { useState, useTransition } from 'react';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import {
  TacSelect,
  TacSelectTrigger,
  TacSelectContent,
  TacSelectItem,
  TacSelectValue,
} from '@/components/ui/tac-select';
import { installPackage } from '@/actions/deps';
import { cn } from '@/lib/utils';

interface DepsInstallFormProps {
  battlefieldId: string;
  onInstallStarted?: () => void;
  className?: string;
}

export function DepsInstallForm({
  battlefieldId,
  onInstallStarted,
  className,
}: DepsInstallFormProps) {
  const [name, setName] = useState('');
  const [depType, setDepType] = useState<'production' | 'dev'>('production');
  const [isPending, startTransition] = useTransition();

  function handleInstall() {
    const trimmed = name.trim();
    if (!trimmed) return;

    startTransition(async () => {
      await installPackage(battlefieldId, trimmed, depType === 'dev');
      setName('');
      onInstallStarted?.();
    });
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-col sm:flex-row gap-3">
        <TacInput
          placeholder="Package name (e.g. lodash)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleInstall();
          }}
          disabled={isPending}
          className="flex-1"
        />
        <TacSelect value={depType} onValueChange={(v) => setDepType(v as 'production' | 'dev')}>
          <TacSelectTrigger className="w-full sm:w-[160px]">
            <TacSelectValue />
          </TacSelectTrigger>
          <TacSelectContent>
            <TacSelectItem value="production">PRODUCTION</TacSelectItem>
            <TacSelectItem value="dev">DEV</TacSelectItem>
          </TacSelectContent>
        </TacSelect>
        <TacButton
          onClick={handleInstall}
          disabled={isPending || !name.trim()}
        >
          {isPending ? 'INSTALLING...' : 'INSTALL'}
        </TacButton>
      </div>
    </div>
  );
}
