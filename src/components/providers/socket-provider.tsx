'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io as ioClient, type Socket } from 'socket.io-client';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const sock = ioClient({
      path: '/socket.io',
      autoConnect: true,
      reconnection: true,
    });

    sock.on('connect', () => {
      console.log('[Socket.IO] Connected:', sock.id);
    });

    sock.on('disconnect', () => {
      console.log('[Socket.IO] Disconnected');
    });

    setSocket(sock);

    return () => {
      sock.disconnect();
    };
  }, []);

  return (
    <SocketContext value={socket}>
      {children}
    </SocketContext>
  );
}

export function useSocketContext() {
  return useContext(SocketContext);
}
