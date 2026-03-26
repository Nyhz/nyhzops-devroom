'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TacButton } from '@/components/ui/tac-button';

interface ScaffoldRetryProps {
  battlefieldId: string;
}

export function ScaffoldRetry({ battlefieldId }: ScaffoldRetryProps) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await fetch(`/api/battlefields/${battlefieldId}/scaffold`, { method: 'POST' });
      router.refresh();
    } catch {
      setRetrying(false);
    }
  }

  return (
    <div className="bg-dr-surface border border-dr-red/40">
      <div className="bg-dr-elevated px-3 py-2 border-b border-dr-red/40 flex items-center gap-2">
        <span className="text-dr-red text-xs font-tactical tracking-wider">
          SCAFFOLD
        </span>
        <span className="text-dr-dim text-xs">&mdash;</span>
        <span className="text-dr-red text-xs">Failed</span>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-dr-muted text-xs font-tactical">
          Commander, the scaffold operation was compromised. Review logs and retry when ready.
        </p>
        <TacButton
          variant="danger"
          size="sm"
          onClick={handleRetry}
          disabled={retrying}
        >
          {retrying ? 'RETRYING...' : 'RETRY SCAFFOLD'}
        </TacButton>
      </div>
    </div>
  );
}
