'use client';

import { useEffect, useRef } from 'react';
import { useSocket } from './use-socket';
import { useStreamingChat, type ChatMessage } from './use-streaming-chat';

export function useGeneral(sessionId: string | null, initialMessages: ChatMessage[]) {
  const socket = useSocket();
  const prevSessionId = useRef(sessionId);

  const { messages, setMessages, streaming, isLoading, error, sendMessage } = useStreamingChat({
    resourceId: sessionId,
    resourceKey: 'sessionId',
    eventPrefix: 'general',
    initialMessages,
  });

  // Reset messages when session changes
  useEffect(() => {
    if (prevSessionId.current !== sessionId) {
      prevSessionId.current = sessionId;
      setMessages(initialMessages);
    }
  }, [sessionId, initialMessages, setMessages]);

  // Listen for system events (unique to general)
  useEffect(() => {
    if (!socket || !sessionId) return;

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

    socket.on('general:system', handleSystem);
    return () => {
      socket.off('general:system', handleSystem);
    };
  }, [socket, sessionId, setMessages]);

  return { messages, streaming, isLoading, error, sendMessage };
}
