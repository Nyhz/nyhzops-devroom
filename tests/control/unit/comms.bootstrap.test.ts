import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  emitComm,
  setCommsEmitter,
  __resetCommsEmitterWarningForTests,
} from '@/control/comms';
import { getDatabase } from '@/lib/db';
import { comms } from '@/lib/db/schema';

const db = getDatabase();

describe('comms bootstrap / setCommsEmitter wiring', () => {
  beforeEach(() => {
    db.delete(comms).run();
    setCommsEmitter(null);
    __resetCommsEmitterWarningForTests();
  });

  afterEach(() => {
    setCommsEmitter(null);
    __resetCommsEmitterWarningForTests();
  });

  it('routes emissions through the registered emitter with (room, event, payload)', () => {
    const calls: Array<{ room: string; event: string; payload: unknown }> = [];
    setCommsEmitter((room, event, payload) => {
      calls.push({ room, event, payload });
    });

    emitComm({ missionId: 'M1', message: 'Test routing' });

    expect(calls.length).toBe(1);
    expect(calls[0].room).toBe('mission:M1');
    expect(calls[0].event).toBe('mission:log');
    const payload = calls[0].payload as { missionId: string | null; message: string };
    expect(payload.missionId).toBe('M1');
    expect(payload.message).toBe('Test routing');
  });

  it('still writes the DB row when no emitter is wired (no throw), warns once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Ensure globalThis.io is also undefined so there is no implicit fallback.
    const savedIo = globalThis.io;
    // @ts-expect-error - intentional test-only teardown
    globalThis.io = undefined;

    try {
      expect(() => emitComm({ missionId: 'M2', message: 'First' })).not.toThrow();
      expect(() => emitComm({ missionId: 'M2', message: 'Second' })).not.toThrow();

      const rows = db.select().from(comms).all();
      expect(rows.length).toBe(2);

      // One-time warning only.
      const warnings = warnSpy.mock.calls.filter((c) =>
        typeof c[0] === 'string' && (c[0] as string).includes('setCommsEmitter not wired'),
      );
      expect(warnings.length).toBe(1);
    } finally {
      warnSpy.mockRestore();
      globalThis.io = savedIo;
    }
  });
});
