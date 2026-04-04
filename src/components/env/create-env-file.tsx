'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import { createEnvFile } from '@/actions/env';

interface CreateEnvFileProps {
  battlefieldId: string;
}

export function CreateEnvFile({ battlefieldId }: CreateEnvFileProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filename, setFilename] = useState('.env');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!filename.trim()) return;

    startTransition(async () => {
      try {
        await createEnvFile(battlefieldId, filename.trim());
        toast.success(`${filename} created`);
        setIsOpen(false);
        setFilename('.env');
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create file';
        toast.error(message);
      }
    });
  }

  if (!isOpen) {
    return (
      <TacButton size="sm" variant="primary" onClick={() => setIsOpen(true)}>
        CREATE FILE
      </TacButton>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <TacInput
        value={filename}
        onChange={(e) => setFilename(e.target.value)}
        placeholder=".env.local"
        className="w-48 py-1.5 text-sm"
        autoFocus
      />
      <TacButton type="submit" size="sm" variant="success" disabled={isPending || !filename.trim()}>
        {isPending ? 'CREATING...' : 'CREATE'}
      </TacButton>
      <TacButton
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setIsOpen(false);
          setFilename('.env');
        }}
      >
        CANCEL
      </TacButton>
    </form>
  );
}
