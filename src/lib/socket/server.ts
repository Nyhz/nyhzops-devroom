import { Server as SocketIOServer } from 'socket.io';
import { eq } from 'drizzle-orm';
import { startMetricsEmitter } from '@/lib/system-metrics';
import type { ClientToServerEvents, ServerToClientEvents } from '@/lib/socket/events';
import { getDatabase } from '@/lib/db/index';
import { managedApps } from '@/lib/db/schema';

function getLogPathForSlug(slug: string): string | null {
  try {
    const row = getDatabase()
      .select()
      .from(managedApps)
      .where(eq(managedApps.slug, slug))
      .get() as { logPath?: string } | undefined;
    return row?.logPath ?? null;
  } catch {
    return null;
  }
}

export function setupSocketIO(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>) {
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.on('system:subscribe', () => {
      socket.join('system:status');
      startMetricsEmitter(io);
    });

    socket.on('system:unsubscribe', () => {
      socket.leave('system:status');
    });

    socket.on('mission:subscribe', (id: string) => {
      socket.join(`mission:${id}`);
    });

    socket.on('mission:unsubscribe', (id: string) => {
      socket.leave(`mission:${id}`);
    });

    socket.on('hq:subscribe', () => {
      socket.join('hq:activity');
    });

    socket.on('devserver:subscribe', (battlefieldId: string) => {
      socket.join(`devserver:${battlefieldId}`);
    });

    socket.on('console:subscribe', (battlefieldId: string) => {
      socket.join(`console:${battlefieldId}`);
    });

    socket.on('console:unsubscribe', (battlefieldId: string) => {
      socket.leave(`console:${battlefieldId}`);
    });

    socket.on('deps:subscribe', (battlefieldId: string) => {
      socket.join(`deps:${battlefieldId}`);
    });

    socket.on('deps:unsubscribe', (battlefieldId: string) => {
      socket.leave(`deps:${battlefieldId}`);
    });

    socket.on('tests:subscribe', (battlefieldId: string) => {
      socket.join(`tests:${battlefieldId}`);
    });

    socket.on('tests:unsubscribe', (battlefieldId: string) => {
      socket.leave(`tests:${battlefieldId}`);
    });

    socket.on('telemetry:subscribe', (battlefieldId: string) => {
      socket.join(`telemetry:${battlefieldId}`);
    });

    socket.on('telemetry:unsubscribe', (battlefieldId: string) => {
      socket.leave(`telemetry:${battlefieldId}`);
    });

    socket.on('devserver:unsubscribe', (battlefieldId: string) => {
      socket.leave(`devserver:${battlefieldId}`);
    });

    socket.on('hq:unsubscribe', () => {
      socket.leave('hq:activity');
    });

    socket.on('campaign:subscribe', (campaignId: string) => {
      socket.join(`campaign:${campaignId}`);
    });

    socket.on('campaign:unsubscribe', (campaignId: string) => {
      socket.leave(`campaign:${campaignId}`);
    });

    socket.on('battlefield:subscribe', (battlefieldId: string) => {
      socket.join(`battlefield:${battlefieldId}`);
    });

    socket.on('battlefield:unsubscribe', (battlefieldId: string) => {
      socket.leave(`battlefield:${battlefieldId}`);
    });

    socket.on('briefing:subscribe', (campaignId: string) => {
      socket.join(`briefing:${campaignId}`);
    });

    socket.on('briefing:unsubscribe', (campaignId: string) => {
      socket.leave(`briefing:${campaignId}`);
    });

    socket.on('briefing:send', async (data: { campaignId: string; message: string }) => {
      try {
        const { sendBriefingMessage } = await import('@/lib/briefing/briefing-engine');
        await sendBriefingMessage(io, data.campaignId, data.message);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Briefing failed';
        // briefing:error is not yet in ServerToClientEvents — open extension.
        (socket.emit as (ev: string, arg: unknown) => boolean)(
          'briefing:error',
          { campaignId: data.campaignId, error: message },
        );
      }
    });

    socket.on('general:subscribe', (sessionId: string) => {
      socket.join(`general:${sessionId}`);
    });

    socket.on('general:unsubscribe', (sessionId: string) => {
      socket.leave(`general:${sessionId}`);
    });

    socket.on('general:send', async (data: { sessionId: string; message: string }) => {
      try {
        const { sendGeneralMessage } = await import('@/lib/general/general-engine');
        await sendGeneralMessage(io, data.sessionId, data.message);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'GENERAL session failed';
        // general:error is not yet in ServerToClientEvents — open extension.
        (socket.emit as (ev: string, arg: unknown) => boolean)(
          'general:error',
          { sessionId: data.sessionId, error: message },
        );
      }
    });

    socket.on('ops:subscribe', () => {
      socket.join('ops:status');
    });

    socket.on('ops:unsubscribe', () => {
      socket.leave('ops:status');
    });

    socket.on('ops:logs:subscribe', (slug: string) => {
      socket.join(`ops:logs:${slug}`);
      const path = getLogPathForSlug(slug);
      if (path) globalThis.logStreamManager?.attach(slug, path);
    });

    socket.on('ops:logs:unsubscribe', (slug: string) => {
      socket.leave(`ops:logs:${slug}`);
      globalThis.logStreamManager?.detach(slug);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
}
