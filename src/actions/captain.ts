'use server';

import {
  queryCaptainLogs,
  computeCaptainStats,
  type CaptainLogFilters,
  type CaptainStats,
} from '@/lib/captain/captain-db';
import type { CaptainLog } from '@/types';

export async function getCaptainLogs(filters?: CaptainLogFilters): Promise<CaptainLog[]> {
  return queryCaptainLogs(filters);
}

export async function getCaptainStats(): Promise<CaptainStats> {
  return computeCaptainStats();
}
