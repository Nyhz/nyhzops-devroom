'use client';

import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { io as ioClient, type Socket } from 'socket.io-client';

interface SocketContextValue {
  socket: Socket | null;
  reconnectKey: number;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, reconnectKey: 0 });

let globalSocket: Socket | null = null;
let globalReconnectKey = 0;
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

function getSocketSnapshot(): Socket | null {
  return globalSocket;
}

function getReconnectKeySnapshot(): number {
  return globalReconnectKey;
}

function getServerSnapshot(): null {
  return null;
}

function getServerReconnectKeySnapshot(): number {
  return 0;
}

export function SocketProvider({ children }: { children: ReactNode }) {
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
        globalReconnectKey++;
        for (const l of listeners) l();
      }
    });

    sock.on('disconnect', () => {
      console.log('[Socket.IO] Disconnected');
    });

    globalSocket = sock;
    for (const l of listeners) l();

    return () => {
      sock.disconnect();
      globalSocket = null;
      for (const l of listeners) l();
    };
  }, []);

  const socket = useSyncExternalStore(subscribe, getSocketSnapshot, getServerSnapshot);
  const reconnectKey = useSyncExternalStore(subscribe, getReconnectKeySnapshot, getServerReconnectKeySnapshot);

  return (
    <SocketContext value={{ socket, reconnectKey }}>
      {children}
    </SocketContext>
  );
}

export function useSocketContext() {
  return useContext(SocketContext);
}
