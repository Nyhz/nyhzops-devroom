'use client';

import { useState, useCallback, useMemo } from 'react';
import { useStreamingChat, type ChatMessage } from './use-streaming-chat';

export function useBriefing(campaignId: string, initialMessages: ChatMessage[]) {
  const [planReady, setPlanReady] = useState(false);

  const extraEvents = useMemo(() => ({
    'plan-ready': () => {
      setPlanReady(true);
    },
  }), []);

  const { messages, streaming, isLoading, error, sendMessage: baseSend } = useStreamingChat({
    resourceId: campaignId,
    resourceKey: 'campaignId',
    eventPrefix: 'briefing',
    initialMessages,
    extraEvents,
  });

  const sendMessage = useCallback((message: string) => {
    setPlanReady(false);
    baseSend(message);
  }, [baseSend]);

  return { messages, streaming, isLoading, error, planReady, sendMessage };
}
