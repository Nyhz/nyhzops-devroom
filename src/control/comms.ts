import { getDatabase } from '@/lib/db';
import { comms } from '@/lib/db/schema';
import { ulid } from 'ulid';

export interface CommEvent {
  missionId?: string;
  campaignId?: string;
  battlefieldId?: string;
  actor?: string; // defaults to 'CONTROL'
  message: string;
  level?: 'info' | 'warn' | 'error';
}

type Emitter = (room: string, event: string, payload: unknown) => void;
let emitter: Emitter | null = null;

export function setCommsEmitter(fn: Emitter | null): void {
  emitter = fn;
}

export function emitComm(ev: CommEvent): void {
  const db = getDatabase();
  const row = {
    id: ulid(),
    missionId: ev.missionId ?? null,
    campaignId: ev.campaignId ?? null,
    battlefieldId: ev.battlefieldId ?? null,
    actor: ev.actor ?? 'CONTROL',
    message: ev.message,
    level: ev.level ?? 'info',
    createdAt: Date.now(),
  };
  db.insert(comms).values(row).run();

  if (emitter && ev.missionId) {
    emitter(`mission:${ev.missionId}`, 'mission:log', row);
  }
  if (emitter && ev.campaignId) {
    emitter(`campaign:${ev.campaignId}`, 'campaign:log', row);
  }
}
