'use client';

import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react';
import { io as ioClient, type Socket } from 'socket.io-client';

interface SocketContextValue {
  socket: Socket | null;
  reconnectKey: number;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, reconnectKey: 0 });

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const initialConnect = useRef(true);

  useEffect(() => {
    const sock = ioClient({
      path: '/socket.io',
      autoConnect: true,
      reconnection: true,
    });

    sock.on('connect', () => {
      console.log('[Socket.IO] Connected:', sock.id);
      if (initialConnect.current) {
        initialConnect.current = false;
      } else {
        // Increment reconnectKey on reconnection so hooks re-subscribe to rooms
        setReconnectKey(k => k + 1);
      }
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
    <SocketContext value={{ socket, reconnectKey }}>
      {children}
    </SocketContext>
  );
}

export function useSocketContext() {
  return useContext(SocketContext);
}
