'use client';

import { useState, useEffect } from 'react';
import { useSocket } from '@/hooks/use-socket';
import { TacBadge } from '@/components/ui/tac-badge';

interface LiveStatusBadgeProps {
  missionId: string;
  initialStatus: string;
}

export function LiveStatusBadge({ missionId, initialStatus }: LiveStatusBadgeProps) {
  const socket = useSocket();
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    if (!socket) return;

    socket.emit('mission:subscribe', missionId);

    const handleStatus = (data: { missionId: string; status: string }) => {
      if (data.missionId === missionId) {
        setStatus(data.status);
      }
    };

    socket.on('mission:status', handleStatus);

    return () => {
      socket.off('mission:status', handleStatus);
      socket.emit('mission:unsubscribe', missionId);
    };
  }, [socket, missionId]);

  return <TacBadge status={status} />;
}
