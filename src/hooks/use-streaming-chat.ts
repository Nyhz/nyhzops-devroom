'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from './use-socket';

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

interface StreamingChatConfig {
  resourceId: string | null;
  resourceKey: string; // 'campaignId' | 'sessionId'
  eventPrefix: string; // 'briefing' | 'general'
  initialMessages: ChatMessage[];
  extraEvents?: Record<string, (data: Record<string, unknown>) => void>;
}

export function useStreamingChat({
  resourceId,
  resourceKey,
  eventPrefix,
  initialMessages,
  extraEvents,
}: StreamingChatConfig) {
  const socket = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef('');
  const isLoadingRef = useRef(false);

  // Keep ref in sync with state for use in sendMessage callback
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    if (!socket || !resourceId) return;

    socket.emit(`${eventPrefix}:subscribe`, resourceId);

    const handleChunk = (data: { content: string; [key: string]: unknown }) => {
      streamRef.current += data.content;
      setStreaming(streamRef.current);
    };

    const handleComplete = (data: { messageId: string; content?: string }) => {
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
    };

    const handleError = (data: { error: string }) => {
      setError(data.error);
      streamRef.current = '';
      setStreaming('');
      setIsLoading(false);
    };

    socket.on(`${eventPrefix}:chunk`, handleChunk);
    socket.on(`${eventPrefix}:complete`, handleComplete);
    socket.on(`${eventPrefix}:error`, handleError);

    // Register extra events with resource ID filtering handled by caller
    const extraCleanups: Array<() => void> = [];
    if (extraEvents) {
      for (const [eventName, handler] of Object.entries(extraEvents)) {
        socket.on(`${eventPrefix}:${eventName}`, handler);
        extraCleanups.push(() => socket.off(`${eventPrefix}:${eventName}`, handler));
      }
    }

    return () => {
      socket.off(`${eventPrefix}:chunk`, handleChunk);
      socket.off(`${eventPrefix}:complete`, handleComplete);
      socket.off(`${eventPrefix}:error`, handleError);
      for (const cleanup of extraCleanups) cleanup();
      socket.emit(`${eventPrefix}:unsubscribe`, resourceId);
    };
  }, [socket, resourceId, eventPrefix, extraEvents]);

  const sendMessage = useCallback(
    (message: string) => {
      if (!socket || !resourceId || isLoadingRef.current) return;

      setIsLoading(true);
      setError(null);
      streamRef.current = '';
      setStreaming('');

      setMessages((prev) => [
        ...prev,
        {
          id: `cmd-${Date.now()}`,
          role: 'commander',
          content: message,
          timestamp: Date.now(),
        },
      ]);

      socket.emit(`${eventPrefix}:send`, { [resourceKey]: resourceId, message });
    },
    [socket, resourceId, resourceKey, eventPrefix],
  );

  return { messages, setMessages, streaming, isLoading, error, sendMessage };
}
