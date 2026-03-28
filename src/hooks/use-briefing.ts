'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from './use-socket';

interface BriefingMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

export function useBriefing(campaignId: string, initialMessages: BriefingMessage[]) {
  const socket = useSocket();
  const [messages, setMessages] = useState<BriefingMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planReady, setPlanReady] = useState(false);
  const streamRef = useRef('');

  useEffect(() => {
    if (!socket) return;

    socket.emit('briefing:subscribe', campaignId);

    const handleChunk = (data: { campaignId: string; content: string }) => {
      if (data.campaignId === campaignId) {
        streamRef.current += data.content;
        setStreaming(streamRef.current);
      }
    };

    const handleComplete = (data: { campaignId: string; messageId: string; content?: string }) => {
      if (data.campaignId === campaignId) {
        const finalContent = streamRef.current || data.content || '';
        setMessages(prev => [
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

    const handleError = (data: { campaignId: string; error: string }) => {
      if (data.campaignId === campaignId) {
        setError(data.error);
        streamRef.current = '';
        setStreaming('');
        setIsLoading(false);
      }
    };

    const handlePlanReady = (data: { campaignId: string }) => {
      if (data.campaignId === campaignId) {
        setPlanReady(true);
      }
    };

    socket.on('briefing:chunk', handleChunk);
    socket.on('briefing:complete', handleComplete);
    socket.on('briefing:error', handleError);
    socket.on('briefing:plan-ready', handlePlanReady);

    return () => {
      socket.off('briefing:chunk', handleChunk);
      socket.off('briefing:complete', handleComplete);
      socket.off('briefing:error', handleError);
      socket.off('briefing:plan-ready', handlePlanReady);
      socket.emit('briefing:unsubscribe', campaignId);
    };
  }, [socket, campaignId]);

  const sendMessage = useCallback((message: string) => {
    if (!socket || isLoading) return;

    setIsLoading(true);
    setError(null);
    setPlanReady(false);
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

    socket.emit('briefing:send', { campaignId, message });
  }, [socket, campaignId, isLoading]);

  return { messages, streaming, isLoading, error, planReady, sendMessage };
}
