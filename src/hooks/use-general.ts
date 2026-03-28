'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from './use-socket';

interface GeneralMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

export function useGeneral(sessionId: string | null, initialMessages: GeneralMessage[]) {
  const socket = useSocket();
  const [messages, setMessages] = useState<GeneralMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef('');

  // Reset messages when session changes
  useEffect(() => {
    setMessages(initialMessages);
    setStreaming('');
    setIsLoading(false);
    setError(null);
    streamRef.current = '';
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!socket || !sessionId) return;

    socket.emit('general:subscribe', sessionId);

    const handleChunk = (data: { sessionId: string; content: string }) => {
      if (data.sessionId === sessionId) {
        streamRef.current += data.content;
        setStreaming(streamRef.current);
      }
    };

    const handleComplete = (data: { sessionId: string; messageId: string; content?: string }) => {
      if (data.sessionId === sessionId) {
        const finalContent = streamRef.current || data.content || '';
        setMessages((prev) => [
          ...prev,
          {
            id: data.messageId,
            role: 'general',
            content: finalContent,
            timestamp: Date.now(),
          },
        ]);
        streamRef.current = '';
        setStreaming('');
        setIsLoading(false);
      }
    };

    const handleError = (data: { sessionId: string; error: string }) => {
      if (data.sessionId === sessionId) {
        setError(data.error);
        streamRef.current = '';
        setStreaming('');
        setIsLoading(false);
      }
    };

    const handleSystem = (data: { sessionId: string; content: string; messageId: string }) => {
      if (data.sessionId === sessionId) {
        setMessages((prev) => [
          ...prev,
          {
            id: data.messageId,
            role: 'system',
            content: data.content,
            timestamp: Date.now(),
          },
        ]);
      }
    };

    socket.on('general:chunk', handleChunk);
    socket.on('general:complete', handleComplete);
    socket.on('general:error', handleError);
    socket.on('general:system', handleSystem);

    return () => {
      socket.off('general:chunk', handleChunk);
      socket.off('general:complete', handleComplete);
      socket.off('general:error', handleError);
      socket.off('general:system', handleSystem);
      socket.emit('general:unsubscribe', sessionId);
    };
  }, [socket, sessionId]);

  const sendMessage = useCallback(
    (message: string) => {
      if (!socket || !sessionId || isLoading) return;

      setIsLoading(true);
      setError(null);
      streamRef.current = '';
      setStreaming('');

      // Optimistic: add commander message immediately
      setMessages((prev) => [
        ...prev,
        {
          id: `cmd-${Date.now()}`,
          role: 'commander',
          content: message,
          timestamp: Date.now(),
        },
      ]);

      socket.emit('general:send', { sessionId, message });
    },
    [socket, sessionId, isLoading],
  );

  return { messages, streaming, isLoading, error, sendMessage };
}
