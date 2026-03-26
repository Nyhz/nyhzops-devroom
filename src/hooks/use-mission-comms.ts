'use client';

import { useEffect, useState, useRef } from 'react';
import { useSocket } from '@/hooks/use-socket';
import type { MissionLog, MissionStatus } from '@/types';

interface MissionTokens {
  input: number;
  output: number;
  cacheHit: number;
  cacheCreation: number;
  costUsd: number;
}

interface UseMissionCommsReturn {
  logs: MissionLog[];
  status: MissionStatus | null;
  debrief: string | null;
  tokens: MissionTokens | null;
}

export function useMissionComms(
  missionId: string,
  initialLogs: MissionLog[],
  initialStatus: string,
): UseMissionCommsReturn {
  const socket = useSocket();
  const [logs, setLogs] = useState<MissionLog[]>(initialLogs);
  const [status, setStatus] = useState<MissionStatus | null>(initialStatus as MissionStatus);
  const [debrief, setDebrief] = useState<string | null>(null);
  const [tokens, setTokens] = useState<MissionTokens | null>(null);
  const logIdCounter = useRef(0);

  useEffect(() => {
    if (!socket) return;

    socket.emit('mission:subscribe', missionId);

    const handleLog = (data: { missionId: string; timestamp: number; type: string; content: string }) => {
      if (data.missionId !== missionId) return;
      logIdCounter.current += 1;
      setLogs(prev => [...prev, {
        id: `live-${logIdCounter.current}`,
        missionId: data.missionId,
        timestamp: data.timestamp,
        type: data.type,
        content: data.content,
      }]);
    };

    const handleStatus = (data: { missionId: string; status: string }) => {
      if (data.missionId !== missionId) return;
      setStatus(data.status as MissionStatus);
    };

    const handleDebrief = (data: { missionId: string; debrief: string }) => {
      if (data.missionId !== missionId) return;
      setDebrief(data.debrief);
    };

    const handleTokens = (data: {
      missionId: string; input: number; output: number;
      cacheHit: number; cacheCreation: number; costUsd: number;
    }) => {
      if (data.missionId !== missionId) return;
      setTokens({
        input: data.input,
        output: data.output,
        cacheHit: data.cacheHit,
        cacheCreation: data.cacheCreation,
        costUsd: data.costUsd,
      });
    };

    socket.on('mission:log', handleLog);
    socket.on('mission:status', handleStatus);
    socket.on('mission:debrief', handleDebrief);
    socket.on('mission:tokens', handleTokens);

    return () => {
      socket.off('mission:log', handleLog);
      socket.off('mission:status', handleStatus);
      socket.off('mission:debrief', handleDebrief);
      socket.off('mission:tokens', handleTokens);
      socket.emit('mission:unsubscribe', missionId);
    };
  }, [socket, missionId]);

  return { logs, status, debrief, tokens };
}
