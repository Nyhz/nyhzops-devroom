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

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });
}
