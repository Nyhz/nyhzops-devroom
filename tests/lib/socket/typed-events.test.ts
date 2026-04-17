import { describe, it, expectTypeOf } from 'vitest';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/lib/socket/events';

describe('socket event map types', () => {
  it('ClientToServerEvents["mission:subscribe"] takes (id: string)', () => {
    expectTypeOf<ClientToServerEvents['mission:subscribe']>()
      .parameter(0)
      .toEqualTypeOf<string>();
  });

  it('ServerToClientEvents["mission:log"] payload includes missionId', () => {
    expectTypeOf<
      Parameters<ServerToClientEvents['mission:log']>[0]
    >().toExtend<{ missionId: string | null }>();
  });

  it('ServerToClientEvents["notification:new"] payload includes level', () => {
    expectTypeOf<
      Parameters<ServerToClientEvents['notification:new']>[0]
    >().toExtend<{ level: string }>();
  });
});
