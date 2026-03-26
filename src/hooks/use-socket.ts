'use client';

import { useSocketContext } from '@/components/providers/socket-provider';

export function useSocket() {
  return useSocketContext();
}
