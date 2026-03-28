import { Server as SocketIOServer } from 'socket.io';

export function setupSocketIO(io: SocketIOServer) {
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

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
        socket.emit('briefing:error', { campaignId: data.campaignId, error: message });
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
        socket.emit('general:error', { sessionId: data.sessionId, error: message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
}
