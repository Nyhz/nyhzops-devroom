'use client';

import { useEffect } from 'react';
import { useSocket, useReconnectKey } from './use-socket';
import { useStreamingChat, type ChatMessage } from './use-streaming-chat';

export function useGeneral(sessionId: string | null, initialMessages: ChatMessage[]) {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();

  const chat = useStreamingChat({
    resourceId: sessionId,
    resourceKey: 'sessionId',
    eventPrefix: 'general',
    initialMessages,
  });

  // Reset messages when session changes
  useEffect(() => {
    chat.setMessages(initialMessages);
    chat.resetStream();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle general:system event (unique to general chat)
  useEffect(() => {
    if (!socket || !sessionId) return;

    const handleSystem = (data: { sessionId: string; content: string; messageId: string }) => {
      if (data.sessionId === sessionId) {
        chat.setMessages(prev => [
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
    return () => { socket.off('general:system', handleSystem); };
  }, [socket, sessionId, reconnectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    messages: chat.messages,
    streaming: chat.streaming,
    isLoading: chat.isLoading,
    error: chat.error,
    sendMessage: chat.sendMessage,
  };
}
