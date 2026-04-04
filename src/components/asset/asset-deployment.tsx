'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';
import { getAssetDeployment, type AssetDeploymentData } from '@/actions/asset';

const PEACE_MESSAGES = [
  'All quiet on all fronts.',
  'No active deployments. Standing by.',
  'Sector clear. Awaiting orders.',
  'All assets at ease, Commander.',
  'Radio silence. No ops in progress.',
];

function getPeaceMessage() {
  return PEACE_MESSAGES[Math.floor(Math.random() * PEACE_MESSAGES.length)];
}

interface AssetDeploymentProps {
  initialData: AssetDeploymentData;
}

export function AssetDeployment({ initialData }: AssetDeploymentProps) {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [data, setData] = useState(initialData);
  const [peaceMsg] = useState(() => getPeaceMessage());

  const refresh = useCallback(async () => {
    try {
      const result = await getAssetDeployment();
      setData(result);
    } catch {
      // silent — keep stale data
    }
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.emit('hq:subscribe');
    refresh(); // eslint-disable-line react-hooks/set-state-in-effect

    const handle = () => refresh();

    socket.on('activity:event', handle);
    socket.on('mission:status', handle);

    return () => {
      socket.off('activity:event', handle);
      socket.off('mission:status', handle);
      socket.emit('hq:unsubscribe');
    };
  }, [socket, refresh, reconnectKey]);

  const { active } = data;
  const allIdle = active.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-4 pb-2 flex items-center justify-between">
        <span className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
          ASSET DEPLOYMENT
        </span>
        <Link
          href="/assets"
          className="text-dr-muted font-tactical text-xs hover:text-dr-text transition-colors"
        >
          manage
        </Link>
      </div>

      {allIdle ? (
        /* Peace time */
        <div className="px-3 py-6 flex flex-col items-center gap-2">
          <span className="text-dr-muted text-lg">&#9790;</span>
          <span className="text-dr-muted font-data text-xs text-center leading-relaxed">
            {peaceMsg}
          </span>
        </div>
      ) : (
        /* Active deployments — one row per mission */
        <div className="px-3 pb-3 space-y-1.5">
          {active.map((entry) => {
            const colorClass =
              entry.status === 'in_combat'
                ? 'text-dr-amber'
                : entry.status === 'reviewing'
                  ? 'text-dr-blue'
                  : entry.status === 'merging'
                    ? 'text-dr-green'
                    : 'text-dr-muted';

            const label =
              entry.status === 'in_combat'
                ? 'ACTIVE'
                : entry.status === 'reviewing'
                  ? 'REVIEWING'
                  : entry.status === 'merging'
                    ? 'MERGING'
                    : 'QUEUED';

            return (
              <div key={entry.id} className="flex items-center gap-2">
                <span className={`text-sm ${colorClass}`}>●</span>
                <div className="min-w-0 flex-1">
                  <div className="text-dr-text font-tactical text-xs truncate">
                    {entry.codename}
                  </div>
                  <div className="text-dr-muted font-data text-xs truncate">
                    {entry.missionTitle}
                  </div>
                </div>
                <span
                  className={`font-tactical text-xs tracking-wider shrink-0 ${colorClass}`}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
