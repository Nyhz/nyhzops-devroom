'use client';

import { TacButton } from '@/components/ui/tac-button';

interface CloseSessionModalProps {
  open: boolean;
  sessionName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function CloseSessionModal({ open, sessionName, onClose, onConfirm }: CloseSessionModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-dr-surface border border-dr-border w-[420px] p-6 space-y-4">
        <div className="text-dr-amber font-tactical text-sm tracking-widest uppercase">
          END SESSION
        </div>

        <p className="text-dr-text font-mono text-sm">
          End session <span className="text-dr-amber font-bold">{sessionName}</span>?
          The conversation history will be preserved but GENERAL will lose context of this session.
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <TacButton variant="ghost" size="sm" onClick={onClose}>
            CANCEL
          </TacButton>
          <TacButton variant="danger" size="sm" onClick={onConfirm}>
            END SESSION
          </TacButton>
        </div>
      </div>
    </div>
  );
}
