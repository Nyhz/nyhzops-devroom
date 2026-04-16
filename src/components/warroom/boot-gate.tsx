'use client';

import { useState, useCallback } from 'react';
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
 * State is initialized lazily: server-side always returns 'booting'; on the
 * client, the lazy initializer reads sessionStorage immediately so returning
 * visitors skip the animation without a useEffect round-trip.
 * - First visit → 'booting' (shows animation)
 * - Returning visit → 'done' (overlay never rendered)
 */
export function BootGate({ children, battlefieldCount, inCombatCount }: BootGateProps) {
  const [state, setState] = useState<'booting' | 'done'>(() => {
    if (typeof window === 'undefined') return 'booting';
    try {
      return sessionStorage.getItem('devroom-booted') === 'true' ? 'done' : 'booting';
    } catch {
      return 'booting';
    }
  });

  const handleBootComplete = useCallback(() => {
    sessionStorage.setItem('devroom-booted', 'true');
    setState('done');
  }, []);

  return (
    <>
      {children}
      {state !== 'done' && (
        <div className="fixed inset-0 z-[9999]">
          <BootSequence
            battlefieldCount={battlefieldCount}
            inCombatCount={inCombatCount}
            onComplete={handleBootComplete}
          />
        </div>
      )}
    </>
  );
}
