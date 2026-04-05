'use client';

import { useState, useTransition } from 'react';
import { updateRulesOfEngagementAction } from '@/actions/settings';
import { TacTextarea } from '@/components/ui/tac-input';
import { TacButton } from '@/components/ui/tac-button';

interface Props {
  initialValue: string;
  initialUpdatedAt: number | null;
}

export function RulesOfEngagementEditor({ initialValue, initialUpdatedAt }: Props) {
  const [value, setValue] = useState(initialValue);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = value !== initialValue && value.trim().length > 0;

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateRulesOfEngagementAction(value);
        const now = Date.now();
        setUpdatedAt(now);
        setSavedAt(now);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    });
  };

  const timestampLabel = updatedAt
    ? `LAST UPDATED: ${new Date(updatedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`
    : 'NEVER UPDATED';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-dr-muted font-tactical uppercase tracking-wider">
          {timestampLabel}
        </div>
        <div className="text-xs text-dr-muted font-tactical">
          APPLIES TO MISSION ASSETS ONLY
        </div>
      </div>
      <TacTextarea
        value={value}
        onChange={e => setValue(e.target.value)}
        className="min-h-[500px] resize-y"
        spellCheck={false}
      />
      {error && (
        <div className="border border-dr-red/50 bg-dr-red/10 p-3 text-sm text-dr-red font-tactical">
          ERROR: {error}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-xs text-dr-muted font-tactical">
          {savedAt && !dirty ? '✓ SAVED' : dirty ? 'UNSAVED CHANGES' : ''}
        </div>
        <TacButton
          type="button"
          onClick={handleSave}
          disabled={!dirty || isPending}
          variant="success"
          size="sm"
        >
          {isPending ? 'SAVING...' : 'SAVE'}
        </TacButton>
      </div>
    </div>
  );
}
