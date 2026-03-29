'use client';

import { useState } from 'react';
import { TacButton } from '@/components/ui/tac-button';

interface Battlefield {
  id: string;
  codename: string;
}

interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, battlefieldId?: string) => void;
  battlefields: Battlefield[];
}

export function NewSessionModal({ open, onClose, onCreate, battlefields }: NewSessionModalProps) {
  const [name, setName] = useState('');
  const [battlefieldId, setBattlefieldId] = useState('');

  if (!open) return null;

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, battlefieldId || undefined);
    setName('');
    setBattlefieldId('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="bg-dr-surface border border-dr-border w-[420px] p-6 space-y-4"
        onKeyDown={handleKeyDown}
      >
        <div className="text-dr-amber font-tactical text-sm tracking-widest uppercase">
          NEW SESSION
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-dr-muted font-tactical text-xs block mb-1">SESSION NAME</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Auth Refactor Discussion"
              className="w-full bg-dr-bg border border-dr-border text-dr-text font-mono text-sm px-3 py-2 focus:border-dr-amber focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="text-dr-muted font-tactical text-xs block mb-1">
              BATTLEFIELD CONTEXT <span className="text-dr-muted">(optional)</span>
            </label>
            <select
              value={battlefieldId}
              onChange={(e) => setBattlefieldId(e.target.value)}
              className="w-full bg-dr-bg border border-dr-border text-dr-text font-mono text-sm px-3 py-2 focus:border-dr-amber focus:outline-none"
            >
              <option value="">None — general conversation</option>
              {battlefields.map((bf) => (
                <option key={bf.id} value={bf.id}>
                  {bf.codename}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <TacButton variant="ghost" size="sm" onClick={onClose}>
            CANCEL
          </TacButton>
          <TacButton variant="success" size="sm" onClick={handleCreate} disabled={!name.trim()}>
            CREATE
          </TacButton>
        </div>
      </div>
    </div>
  );
}
