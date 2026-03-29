'use client';

import { useState, useCallback, useMemo } from 'react';
import { useStreamingChat, type ChatMessage } from './use-streaming-chat';

export function useBriefing(campaignId: string, initialMessages: ChatMessage[]) {
  const [planReady, setPlanReady] = useState(false);

  const extraEvents = useMemo(() => ({
    'briefing:plan-ready': (data: Record<string, unknown>) => {
      if (data.campaignId === campaignId) {
        setPlanReady(true);
      }
    },
  }), [campaignId]);

  const chat = useStreamingChat({
    resourceId: campaignId,
    resourceKey: 'campaignId',
    eventPrefix: 'briefing',
    initialMessages,
    extraEvents,
  });

  const sendMessage = useCallback((message: string) => {
    setPlanReady(false);
    chat.sendMessage(message);
  }, [chat.sendMessage]);

  return {
    messages: chat.messages,
    streaming: chat.streaming,
    isLoading: chat.isLoading,
    error: chat.error,
    planReady,
    sendMessage,
  };
}
