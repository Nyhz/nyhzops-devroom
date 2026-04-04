'use client';

import { useState, useEffect, useCallback } from 'react';
import { BootSequence } from './boot-sequence';

interface BootGateProps {
  children: React.ReactNode;
  battlefieldCount: number;
  inCombatCount: number;
}

/**
 * Shows the boot animation as a full-screen overlay on first visit.
 * Uses sessionStorage so it only plays once per browser session.
 *
 * Renders a solid covering overlay from initial paint (server + client agree on 'pending')
 * to prevent any flash of underlying content. useEffect then checks sessionStorage:
 * - First visit → transitions to 'booting' (shows animation)
 * - Returning visit → transitions to 'done' (overlay removed immediately)
 */
export function BootGate({ children, battlefieldCount, inCombatCount }: BootGateProps) {
  const [state, setState] = useState<'pending' | 'booting' | 'done'>('pending');

  useEffect(() => {
    try {
      if (sessionStorage.getItem('devroom-booted') === 'true') {
        setState('done');
      } else {
        setState('booting');
      }
    } catch {
      setState('booting');
    }
  }, []);

  const handleBootComplete = useCallback(() => {
    sessionStorage.setItem('devroom-booted', 'true');
    setState('done');
  }, []);

  return (
    <>
      {children}
      {state !== 'done' && (
        <div className="fixed inset-0 z-[9999]">
          {state === 'booting' ? (
            <BootSequence
              battlefieldCount={battlefieldCount}
              inCombatCount={inCombatCount}
              onComplete={handleBootComplete}
            />
          ) : (
            <div className="fixed inset-0 bg-dr-bg" />
          )}
        </div>
      )}
    </>
  );
}
