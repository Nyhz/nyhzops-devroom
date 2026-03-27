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
 * The children render underneath (no flash) — the overlay covers them.
 */
export function BootGate({ children, battlefieldCount, inCombatCount }: BootGateProps) {
  const [showOverlay, setShowOverlay] = useState(true);
  const [alreadyBooted, setAlreadyBooted] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('devroom-booted') === 'true') {
      setAlreadyBooted(true);
      setShowOverlay(false);
    }
  }, []);

  const handleBootComplete = useCallback(() => {
    sessionStorage.setItem('devroom-booted', 'true');
    setShowOverlay(false);
  }, []);

  return (
    <>
      {children}
      {showOverlay && !alreadyBooted && (
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
