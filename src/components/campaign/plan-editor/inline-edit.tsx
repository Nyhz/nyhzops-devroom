'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { TacInput, TacTextarea } from '@/components/ui/tac-input';

interface InlineEditProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}

export function InlineEdit({
  value,
  onChange,
  placeholder,
  multiline,
  className,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = useCallback(() => {
    setEditing(false);
    if (draft !== value) {
      onChange(draft);
    }
  }, [draft, value, onChange]);

  if (editing) {
    if (multiline) {
      return (
        <TacTextarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(value);
              setEditing(false);
            }
          }}
          placeholder={placeholder}
          className={cn('min-h-[60px] text-xs', className)}
        />
      );
    }
    return (
      <TacInput
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        className={cn('text-xs', className)}
      />
    );
  }

  return (
    <span
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={cn(
        'cursor-pointer hover:bg-dr-elevated/50 px-1 -mx-1 transition-colors',
        !value && 'text-dr-dim italic',
        className,
      )}
      title="Click to edit"
    >
      {value || placeholder || '(empty)'}
    </span>
  );
}
