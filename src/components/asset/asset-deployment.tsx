'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSocket } from '@/hooks/use-socket';
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
  const [data, setData] = useState(initialData);
  const [peaceMsg, setPeaceMsg] = useState(PEACE_MESSAGES[0]);
  useEffect(() => { setPeaceMsg(getPeaceMessage()); }, []);

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

    const handle = () => refresh();

    socket.on('activity:event', handle);
    socket.on('mission:status', handle);

    return () => {
      socket.off('activity:event', handle);
      socket.off('mission:status', handle);
    };
  }, [socket, refresh]);

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
          {active.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2">
              <span
                className={`text-sm ${
                  entry.status === 'in_combat' ? 'text-dr-amber' : 'text-dr-blue'
                }`}
              >
                ●
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-dr-text font-tactical text-xs truncate">
                  {entry.codename}
                </div>
                <div className="text-dr-muted font-data text-xs truncate">
                  {entry.missionTitle}
                </div>
              </div>
              <span
                className={`font-tactical text-xs tracking-wider shrink-0 ${
                  entry.status === 'in_combat' ? 'text-dr-amber' : 'text-dr-blue'
                }`}
              >
                {entry.status === 'in_combat' ? 'ACTIVE' : 'QUEUED'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
