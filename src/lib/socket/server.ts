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

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
}
