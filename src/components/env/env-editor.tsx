'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import { EnvVariableRow } from './env-variable-row';
import { saveEnvFile } from '@/actions/env';
import type { EnvVariable } from '@/types';

interface EnvEditorProps {
  battlefieldId: string;
  filename: string;
  initialVariables: EnvVariable[];
  exampleVariables?: EnvVariable[];
  inGitignore: boolean;
}

export function EnvEditor({
  battlefieldId,
  filename,
  initialVariables,
  exampleVariables,
  inGitignore,
}: EnvEditorProps) {
  const [variables, setVariables] = useState<EnvVariable[]>(initialVariables);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleChange(index: number, updated: EnvVariable) {
    setVariables((prev) => prev.map((v, i) => (i === index ? updated : v)));
  }

  function handleDelete(index: number) {
    setVariables((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newKey.trim()) return;
    setVariables((prev) => [
      ...prev,
      { key: newKey.trim(), value: newValue, lineNumber: prev.length + 1 },
    ]);
    setNewKey('');
    setNewValue('');
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await saveEnvFile(battlefieldId, filename, variables);
        toast.success(`${filename} saved`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Save failed';
        toast.error(message);
      }
    });
  }

  function getExampleHint(key: string): string | undefined {
    if (!exampleVariables) return undefined;
    const match = exampleVariables.find((v) => v.key === key);
    return match?.value;
  }

  return (
    <div className="space-y-4">
      {!inGitignore && (
        <div className="bg-red-900/30 border border-red-500/50 text-red-400 font-tactical text-sm p-3 tracking-wider">
          WARNING: This file is NOT in .gitignore — secrets may be committed.
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-dr-muted font-tactical text-xs tracking-wider uppercase">
          {variables.length} variable{variables.length !== 1 ? 's' : ''}
        </span>
        <TacButton
          size="sm"
          variant="success"
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? 'SAVING...' : 'SAVE'}
        </TacButton>
      </div>

      <div className="space-y-1">
        {variables.map((variable, index) => (
          <EnvVariableRow
            key={`${variable.key}-${index}`}
            variable={variable}
            exampleHint={getExampleHint(variable.key)}
            onChange={(updated) => handleChange(index, updated)}
            onDelete={() => handleDelete(index)}
          />
        ))}
        {variables.length === 0 && (
          <div className="text-dr-dim font-tactical text-sm p-4 text-center border border-dr-border border-dashed">
            No variables. Add one below.
          </div>
        )}
      </div>

      <form
        onSubmit={handleAdd}
        className={cn(
          'flex items-center gap-2 border border-dr-border p-3',
          'bg-dr-surface/50',
        )}
      >
        <TacInput
          value={newKey}
          onChange={(e) => setNewKey(e.target.value.toUpperCase())}
          placeholder="KEY"
          className="flex-1 py-1.5 text-sm"
        />
        <span className="text-dr-dim font-tactical">=</span>
        <TacInput
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="value"
          className="flex-[2] py-1.5 text-sm"
        />
        <TacButton type="submit" size="sm" variant="primary" disabled={!newKey.trim()}>
          ADD
        </TacButton>
      </form>
    </div>
  );
}
