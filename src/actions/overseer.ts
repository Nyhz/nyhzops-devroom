'use server';

import {
  queryOverseerLogs,
  computeOverseerStats,
  type OverseerLogFilters,
  type OverseerStats,
} from '@/lib/overseer/overseer-db';
import type { OverseerLog } from '@/types';

export async function getOverseerLogs(filters?: OverseerLogFilters): Promise<OverseerLog[]> {
  return queryOverseerLogs(filters);
}

export async function getOverseerStats(): Promise<OverseerStats> {
  return computeOverseerStats();
}
