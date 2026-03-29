'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMissionComms } from '@/hooks/use-mission-comms';
import { TacCard } from '@/components/ui/tac-card';
import { Terminal } from '@/components/ui/terminal';

interface BootstrapCommsProps {
  missionId: string;
  codename: string;
}

export function BootstrapComms({ missionId, codename }: BootstrapCommsProps) {
  const router = useRouter();
  const { logs, status } = useMissionComms(missionId, [], 'queued');
  const hasRefreshed = useRef(false);

  // When bootstrap completes, wait 1s then refresh page to show review screen
  useEffect(() => {
    if (hasRefreshed.current) return;
    if (status === 'accomplished' || status === 'compromised') {
      hasRefreshed.current = true;
      const timer = setTimeout(() => router.refresh(), 1000);
      return () => clearTimeout(timer);
    }
  }, [status, router]);

  // Terminal expects type: 'log' | 'status' | 'error'; MissionLog.type is string
  const terminalLogs = logs.map(entry => ({
    timestamp: entry.timestamp,
    type: entry.type as 'log' | 'status' | 'error',
    content: entry.content,
  }));

  return (
    <div className="p-4 md:p-6">
      <div className="text-dr-muted text-xs mb-1">Battlefields //</div>
      <h1 className="text-dr-amber text-xl font-tactical tracking-wider mb-1">
        {codename} — INITIALIZING
      </h1>
      <p className="text-dr-dim text-sm animate-pulse mb-6">
        Generating battlefield intel...
      </p>

      <TacCard className="p-0">
        <div className="bg-dr-elevated px-3 py-2 border-b border-dr-border">
          <span className="text-dr-amber text-xs font-tactical tracking-wider">COMMS</span>
        </div>
        <div className="max-h-96">
          <Terminal logs={terminalLogs} />
        </div>
      </TacCard>
    </div>
  );
}
