'use client';
import { useEffect, useState } from 'react';
import { useSocket } from '@/hooks/use-socket';
import { OpsCard } from './OpsCard';
import { OpsDetail } from './OpsDetail';
import type { OpsStatus } from '@/lib/ops/types';

interface Props {
  initial: OpsStatus[];
}

export function OpsGrid({ initial }: Props) {
  const socket = useSocket();
  const [snapshot, setSnapshot] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initial[0]?.slug ?? null);

  useEffect(() => {
    if (!socket) return;
    socket.emit('ops:subscribe');
    const onStatus = (s: OpsStatus[]) => setSnapshot(s);
    socket.on('ops:status', onStatus);
    return () => {
      socket.off('ops:status', onStatus);
      socket.emit('ops:unsubscribe');
    };
  }, [socket]);

  const current = snapshot.find((s) => s.slug === selected) ?? snapshot[0];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4">
        {snapshot.map((s) => (
          <OpsCard
            key={s.slug}
            status={s}
            selected={s.slug === selected}
            onClick={() => setSelected(s.slug)}
          />
        ))}
      </div>
      {current && <OpsDetail status={current} />}
    </div>
  );
}
