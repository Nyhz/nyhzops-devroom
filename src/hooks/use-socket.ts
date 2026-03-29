'use client';

import { useSocketContext } from '@/components/providers/socket-provider';

export function useSocket() {
  return useSocketContext().socket;
}

export function useReconnectKey() {
  return useSocketContext().reconnectKey;
}
