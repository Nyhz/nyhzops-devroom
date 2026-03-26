'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TacButton } from '@/components/ui/tac-button';
import { abandonMission } from '@/actions/mission';

interface MissionActionsProps {
  missionId: string;
  status: string;
  battlefieldId: string;
}

export function MissionActions({ missionId, status, battlefieldId }: MissionActionsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const canAbandon = status === 'standby' || status === 'queued';

  const handleAbandon = async () => {
    if (!confirm('Abandon this mission?')) return;
    setIsPending(true);
    try {
      await abandonMission(missionId);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex gap-3">
      <TacButton
        variant="danger"
        onClick={handleAbandon}
        disabled={!canAbandon || isPending}
      >
        {isPending ? 'ABANDONING...' : 'ABANDON'}
      </TacButton>
    </div>
  );
}
