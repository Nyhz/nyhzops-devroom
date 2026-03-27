'use client';

import { useState, useCallback, useRef } from 'react';
import {
  TacModal,
  TacModalContent,
  TacModalHeader,
  TacModalTitle,
  TacModalDescription,
  TacModalFooter,
} from '@/components/ui/modal';
import { TacButton } from '@/components/ui/tac-button';

interface ConfirmAction {
  label: string;
  variant?: 'primary' | 'danger' | 'ghost' | 'success';
  className?: string;
}

interface ConfirmOptions {
  title: string;
  description?: string;
  body?: React.ReactNode;
  actions: ConfirmAction[];
}

/**
 * Returns [confirm, ConfirmDialog].
 * `confirm(options)` returns a Promise that resolves to the index of the
 * clicked action, or -1 if cancelled (clicked outside / pressed Esc).
 * Render `<ConfirmDialog />` once in the component tree.
 */
export function useConfirm(): [
  (options: ConfirmOptions) => Promise<number>,
  () => React.ReactNode,
] {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((index: number) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<number> => {
    setOptions(opts);
    setOpen(true);
    return new Promise<number>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleAction = useCallback((index: number) => {
    setOpen(false);
    resolveRef.current?.(index);
    resolveRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setOpen(false);
    resolveRef.current?.(-1);
    resolveRef.current = null;
  }, []);

  const ConfirmDialog = useCallback(() => {
    if (!options) return null;
    return (
      <TacModal open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
        <TacModalContent showCloseButton={false}>
          <TacModalHeader>
            <TacModalTitle>{options.title}</TacModalTitle>
            {options.description && (
              <TacModalDescription>{options.description}</TacModalDescription>
            )}
          </TacModalHeader>
          {options.body && (
            <div className="px-5 pb-5 text-xs font-data text-dr-muted">
              {options.body}
            </div>
          )}
          <TacModalFooter>
            <TacButton variant="ghost" onClick={handleCancel}>
              CANCEL
            </TacButton>
            {options.actions.map((action, i) => (
              <TacButton
                key={i}
                variant={action.variant ?? 'primary'}
                className={action.className}
                onClick={() => handleAction(i)}
              >
                {action.label}
              </TacButton>
            ))}
          </TacModalFooter>
        </TacModalContent>
      </TacModal>
    );
  }, [open, options, handleAction, handleCancel]);

  return [confirm, ConfirmDialog];
}
