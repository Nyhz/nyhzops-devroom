'use client';

import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { TacCard } from '@/components/ui/tac-card';
import { addSuggestionToBoard, dismissSuggestion } from '@/actions/follow-up';
import type { FollowUpSuggestion, FollowUpSuggestionStatus } from '@/types';

interface FollowUpCardsProps {
  suggestions: FollowUpSuggestion[];
  className?: string;
}

export function FollowUpCards({ suggestions, className }: FollowUpCardsProps) {
  const pendingSuggestions = suggestions.filter((s) => s.status === 'pending');
  const resolvedCount = suggestions.filter(
    (s) => s.status === 'added' || s.status === 'dismissed',
  ).length;

  // Nothing to show
  if (suggestions.length === 0) return null;

  // All resolved — collapsed summary
  if (pendingSuggestions.length === 0) {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="space-y-1">
          <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
            RECOMMENDED NEXT ACTIONS
          </h2>
          <div className="h-px bg-dr-border" />
        </div>
        <p className="text-xs font-tactical text-dr-dim">
          {resolvedCount} suggestion{resolvedCount !== 1 ? 's' : ''} processed
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="space-y-1">
        <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
          RECOMMENDED NEXT ACTIONS ({pendingSuggestions.length})
        </h2>
        <div className="h-px bg-dr-border" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {suggestions.map((suggestion) => (
          <SuggestionCard key={suggestion.id} suggestion={suggestion} />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: FollowUpSuggestion }) {
  const [status, setStatus] = useState<FollowUpSuggestionStatus>(
    suggestion.status as FollowUpSuggestionStatus,
  );
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setStatus('added');
    startTransition(async () => {
      await addSuggestionToBoard(suggestion.id);
    });
  }

  function handleDismiss() {
    setStatus('dismissed');
    startTransition(async () => {
      await dismissSuggestion(suggestion.id);
    });
  }

  if (status === 'added') {
    return (
      <TacCard status="green" className="px-3 py-2.5 space-y-2">
        <p className="text-sm font-data text-dr-text">{suggestion.suggestion}</p>
        <p className="text-xs font-tactical text-dr-green tracking-wider">
          ADDED TO INTEL BOARD
        </p>
      </TacCard>
    );
  }

  if (status === 'dismissed') {
    return (
      <TacCard status="dim" className="px-3 py-2.5 space-y-2 opacity-50">
        <p className="text-sm font-data text-dr-dim line-through">
          {suggestion.suggestion}
        </p>
        <p className="text-xs font-tactical text-dr-dim tracking-wider">
          DISMISSED
        </p>
      </TacCard>
    );
  }

  return (
    <TacCard className="px-3 py-2.5 space-y-3">
      <p className="text-sm font-data text-dr-text">{suggestion.suggestion}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAdd}
          disabled={isPending}
          aria-label={`Add suggestion to Intel Board: ${suggestion.suggestion}`}
          className={cn(
            'px-3 py-1 text-xs font-tactical tracking-wider border transition-colors',
            'text-dr-green border-dr-green hover:bg-dr-green/10',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {isPending ? 'ADDING...' : 'ADD TO BOARD'}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={isPending}
          aria-label={`Dismiss suggestion: ${suggestion.suggestion}`}
          className={cn(
            'px-3 py-1 text-xs font-tactical tracking-wider border transition-colors',
            'text-dr-dim border-dr-border hover:bg-dr-elevated/50',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          DISMISS
        </button>
      </div>
    </TacCard>
  );
}
