'use client';

import { useEffect, useState, useRef } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';
import type { MissionLog, MissionStatus } from '@/types';

export type LiveMissionLog = MissionLog & { actor?: string };

const MAX_LOGS = 1000;

interface MissionTokens {
  input: number;
  output: number;
  cacheHit: number;
  cacheCreation: number;
  costUsd: number;
}

interface UseMissionCommsReturn {
  logs: LiveMissionLog[];
  status: MissionStatus | null;
  debrief: string | null;
  tokens: MissionTokens | null;
  compromiseReason: string | null;
}

export function useMissionComms(
  missionId: string,
  initialLogs: MissionLog[],
  initialStatus: string,
): UseMissionCommsReturn {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [logs, setLogs] = useState<LiveMissionLog[]>(initialLogs);
  const [status, setStatus] = useState<MissionStatus | null>(initialStatus as MissionStatus);
  const [debrief, setDebrief] = useState<string | null>(null);
  const [tokens, setTokens] = useState<MissionTokens | null>(null);
  const [compromiseReason, setCompromiseReason] = useState<string | null>(null);
  const logIdCounter = useRef(0);

  useEffect(() => {
    if (!socket) return;

    socket.emit('mission:subscribe', missionId);

    const handleLog = (data: {
      id: string;
      missionId: string | null;
      actor: string;
      message: string;
      level: string;
      createdAt: number;
    }) => {
      if (data.missionId !== missionId) return;
      logIdCounter.current += 1;
      const levelTypeMap: Record<string, string> = { warn: 'sitrep', error: 'alert' };
      setLogs(prev => {
        const next = [...prev, {
          id: `live-${logIdCounter.current}`,
          missionId: data.missionId ?? '',
          timestamp: data.createdAt,
          type: levelTypeMap[data.level] ?? 'comms',
          content: data.message,
          actor: data.actor,
        }];
        if (next.length > MAX_LOGS) {
          return next.slice(next.length - MAX_LOGS);
        }
        return next;
      });
    };

    const handleStatus = (data: { missionId: string; status: string; compromiseReason?: string }) => {
      if (data.missionId !== missionId) return;
      setStatus(data.status as MissionStatus);
      if (data.compromiseReason) setCompromiseReason(data.compromiseReason);
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
  }, [socket, missionId, reconnectKey]);

  return { logs, status, debrief, tokens, compromiseReason };
}
