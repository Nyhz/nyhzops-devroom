'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import type { EnvVariable } from '@/types';

interface EnvVariableRowProps {
  variable: EnvVariable;
  exampleHint?: string;
  onChange: (updated: EnvVariable) => void;
  onDelete: () => void;
}

export function EnvVariableRow({ variable, exampleHint, onChange, onDelete }: EnvVariableRowProps) {
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editKey, setEditKey] = useState(variable.key);
  const [editValue, setEditValue] = useState(variable.value);

  function handleSave() {
    onChange({ ...variable, key: editKey, value: editValue });
    setEditing(false);
  }

  function handleCancel() {
    setEditKey(variable.key);
    setEditValue(variable.value);
    setEditing(false);
  }

  function handleStartEdit() {
    setEditKey(variable.key);
    setEditValue(variable.value);
    setEditing(true);
  }

  const showHint = exampleHint !== undefined && exampleHint !== variable.value;

  if (editing) {
    return (
      <div className="flex flex-col gap-2 bg-dr-surface border border-dr-border p-3">
        <div className="flex items-center gap-2">
          <TacInput
            value={editKey}
            onChange={(e) => setEditKey(e.target.value)}
            placeholder="KEY"
            className="flex-1 py-1.5 text-sm"
          />
          <span className="text-dr-dim font-tactical">=</span>
          <TacInput
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="value"
            className="flex-[2] py-1.5 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 justify-end">
          <TacButton size="sm" variant="success" onClick={handleSave}>
            SAVE
          </TacButton>
          <TacButton size="sm" variant="ghost" onClick={handleCancel}>
            CANCEL
          </TacButton>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col bg-dr-surface border border-dr-border p-3">
      <div className="flex items-center gap-3">
        <span className="text-dr-text font-tactical text-sm tracking-wider shrink-0">
          {variable.key}
        </span>
        <span className="text-dr-dim font-tactical">=</span>
        <span className={cn(
          'flex-1 font-mono text-sm truncate min-w-0',
          revealed ? 'text-dr-text' : 'text-dr-muted',
        )}>
          {revealed ? variable.value : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
        </span>
        <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
          <TacButton
            size="sm"
            variant="ghost"
            onClick={() => setRevealed(!revealed)}
            title={revealed ? 'Hide value' : 'Reveal value'}
          >
            {revealed ? '[HIDE]' : '[SHOW]'}
          </TacButton>
          <TacButton size="sm" variant="ghost" onClick={handleStartEdit} title="Edit variable">
            [EDIT]
          </TacButton>
          <TacButton size="sm" variant="danger" onClick={onDelete} title="Delete variable">
            X
          </TacButton>
        </div>
      </div>
      {showHint && (
        <span className="text-dr-dim text-xs font-tactical mt-1 pl-0">
          .env.example: {exampleHint}
        </span>
      )}
    </div>
  );
}
