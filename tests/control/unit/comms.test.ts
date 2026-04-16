import { describe, it, expect, beforeEach } from 'vitest';
import { emitComm, setCommsEmitter } from '@/control/comms';
import { getDatabase } from '@/lib/db';
import { comms } from '@/lib/db/schema';

const db = getDatabase();

describe('emitComm', () => {
  beforeEach(() => {
    db.delete(comms).run();
    setCommsEmitter(null); // no socket.io in unit tests
  });

  it('writes a comms row with CONTROL as actor when no actor override', () => {
    emitComm({ missionId: 'm1', message: 'Deploying mission' });
    const rows = db.select().from(comms).all();
    expect(rows.length).toBe(1);
    expect(rows[0].actor).toBe('CONTROL');
    expect(rows[0].message).toBe('Deploying mission');
    expect(rows[0].missionId).toBe('m1');
  });

  it('accepts actor override for asset-emitted events', () => {
    emitComm({ missionId: 'm1', actor: 'OPERATIVE', message: 'Running tests' });
    const rows = db.select().from(comms).all();
    expect(rows[0].actor).toBe('OPERATIVE');
  });

  it('invokes socket.io emitter when registered', () => {
    let emitted: { room: string; event: string; payload: unknown } | null = null;
    setCommsEmitter((room, event, payload) => {
      emitted = { room, event, payload };
    });
    emitComm({ missionId: 'm1', message: 'Hello' });
    expect(emitted).not.toBeNull();
    expect(emitted!.room).toBe('mission:m1');
    expect(emitted!.event).toBe('mission:log');
  });
});
