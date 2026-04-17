'use client';

import { useState, useCallback, useEffect } from 'react';
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
 * Always starts as 'booting' (matching SSR) then checks sessionStorage after
 * mount to skip the animation for returning visitors.
 */
export function BootGate({ children, battlefieldCount, inCombatCount }: BootGateProps) {
  const [state, setState] = useState<'booting' | 'done'>('booting');

  useEffect(() => {
    try {
      if (sessionStorage.getItem('devroom-booted') === 'true') {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: mount-only skip check, SSR renders 'booting' to avoid hydration mismatch
        setState('done');
      }
    } catch {
      // sessionStorage unavailable — animation plays normally
    }
  }, []);

  const handleBootComplete = useCallback(() => {
    try {
      sessionStorage.setItem('devroom-booted', 'true');
    } catch {
      // ignore
    }
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
