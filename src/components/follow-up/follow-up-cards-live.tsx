'use client';

import { useEffect, useState } from 'react';
import { useSocket } from '@/hooks/use-socket';
import { FollowUpCards } from './follow-up-cards';
import type { FollowUpSuggestion } from '@/types';

interface FollowUpCardsLiveProps {
  missionId: string;
  initialSuggestions: FollowUpSuggestion[];
  className?: string;
}

export function FollowUpCardsLive({
  missionId,
  initialSuggestions,
  className,
}: FollowUpCardsLiveProps) {
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const socket = useSocket();

  // Sync with server-provided data on refresh
  useEffect(() => {
    setSuggestions(initialSuggestions);
  }, [initialSuggestions]);

  useEffect(() => {
    if (!socket) return;

    const handleSuggestions = (data: {
      missionId: string;
      suggestions: FollowUpSuggestion[];
    }) => {
      if (data.missionId !== missionId) return;
      setSuggestions(data.suggestions);
    };

    socket.on('mission:suggestions', handleSuggestions);

    return () => {
      socket.off('mission:suggestions', handleSuggestions);
    };
  }, [socket, missionId]);

  return <FollowUpCards suggestions={suggestions} className={className} />;
}
