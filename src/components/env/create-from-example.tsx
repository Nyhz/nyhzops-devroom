'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { createEnvFile } from '@/actions/env';

interface CreateFromExampleProps {
  battlefieldId: string;
}

export function CreateFromExample({ battlefieldId }: CreateFromExampleProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleCreate() {
    startTransition(async () => {
      try {
        await createEnvFile(battlefieldId, '.env');
        toast.success('.env created');
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create file';
        toast.error(message);
      }
    });
  }

  return (
    <TacButton variant="primary" onClick={handleCreate} disabled={isPending}>
      {isPending ? 'CREATING...' : 'CREATE .env FROM EXAMPLE'}
    </TacButton>
  );
}
