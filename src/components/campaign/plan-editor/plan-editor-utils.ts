import type { MissionPriority } from '@/types';

// ---------------------------------------------------------------------------
// ID helpers — encode phase/mission indices into unique drag IDs
// ---------------------------------------------------------------------------

export function phaseId(index: number): string {
  return `phase-${index}`;
}

export function missionId(phaseIndex: number, missionIndex: number): string {
  return `mission-${phaseIndex}-${missionIndex}`;
}

export function parseMissionId(id: string): { phaseIndex: number; missionIndex: number } | null {
  const match = id.match(/^mission-(\d+)-(\d+)$/);
  if (!match) return null;
  return { phaseIndex: Number(match[1]), missionIndex: Number(match[2]) };
}

export function parsePhaseId(id: string): number | null {
  const match = id.match(/^phase-(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

// ---------------------------------------------------------------------------
// Priority config
// ---------------------------------------------------------------------------

export const PRIORITIES: MissionPriority[] = ['low', 'routine', 'high', 'critical'];

export const priorityDotColor: Record<string, string> = {
  low: 'bg-dr-dim',
  routine: 'bg-dr-muted',
  high: 'bg-dr-amber',
  critical: 'bg-dr-red',
};
