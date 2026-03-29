'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket, useReconnectKey } from './use-socket';

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

interface StreamingChatConfig {
  /** The ID of the resource (campaignId or sessionId). Null disables the hook. */
  resourceId: string | null;
  /** Key name used in payloads, e.g. 'campaignId' or 'sessionId' */
  resourceKey: string;
  /** Socket event prefix, e.g. 'briefing' or 'general' */
  eventPrefix: string;
  /** Initial messages from server */
  initialMessages: ChatMessage[];
  /** Additional socket event handlers keyed by full event name */
  extraEvents?: Record<string, (data: Record<string, unknown>) => void>;
}

interface StreamingChatReturn {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  streaming: string;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  sendMessage: (message: string) => void;
  resetStream: () => void;
}

export function useStreamingChat({
  resourceId,
  resourceKey,
  eventPrefix,
  initialMessages,
  extraEvents,
}: StreamingChatConfig): StreamingChatReturn {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef('');
  const isLoadingRef = useRef(false);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const extraEventsRef = useRef(extraEvents);
  useEffect(() => {
    extraEventsRef.current = extraEvents;
  });

  useEffect(() => {
    if (!socket || !resourceId) return;

    socket.emit(`${eventPrefix}:subscribe`, resourceId);

    const handleChunk = (data: Record<string, unknown>) => {
      if (data[resourceKey] !== resourceId) return;
      streamRef.current += data.content as string;
      setStreaming(streamRef.current);
    };

    const handleComplete = (data: Record<string, unknown>) => {
      if (data[resourceKey] !== resourceId) return;
      const finalContent = streamRef.current || (data.content as string) || '';
      setMessages(prev => [
        ...prev,
        {
          id: data.messageId as string,
          role: 'general',
          content: finalContent,
          timestamp: Date.now(),
        },
      ]);
      streamRef.current = '';
      setStreaming('');
      setIsLoading(false);
    };

    const handleError = (data: Record<string, unknown>) => {
      if (data[resourceKey] !== resourceId) return;
      setError(data.error as string);
      streamRef.current = '';
      setStreaming('');
      setIsLoading(false);
    };

    socket.on(`${eventPrefix}:chunk`, handleChunk);
    socket.on(`${eventPrefix}:complete`, handleComplete);
    socket.on(`${eventPrefix}:error`, handleError);

    const currentExtraEvents = extraEventsRef.current;
    const extraCleanups: Array<() => void> = [];
    if (currentExtraEvents) {
      for (const [event, handler] of Object.entries(currentExtraEvents)) {
        socket.on(event, handler);
        extraCleanups.push(() => socket.off(event, handler));
      }
    }

    return () => {
      socket.off(`${eventPrefix}:chunk`, handleChunk);
      socket.off(`${eventPrefix}:complete`, handleComplete);
      socket.off(`${eventPrefix}:error`, handleError);
      for (const cleanup of extraCleanups) cleanup();
      socket.emit(`${eventPrefix}:unsubscribe`, resourceId);
    };
  }, [socket, resourceId, resourceKey, eventPrefix, reconnectKey]);

  const sendMessage = useCallback(
    (message: string) => {
      if (!socket || !resourceId || isLoadingRef.current) return;

      setIsLoading(true);
      setError(null);
      streamRef.current = '';
      setStreaming('');

      setMessages(prev => [
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

  const resetStream = useCallback(() => {
    streamRef.current = '';
    setStreaming('');
    setIsLoading(false);
    setError(null);
  }, []);

  return { messages, setMessages, streaming, isLoading, setIsLoading, error, setError, sendMessage, resetStream };
}
