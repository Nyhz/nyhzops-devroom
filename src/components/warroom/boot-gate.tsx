'use client';

import { useState, useEffect, useCallback } from 'react';
import { BootSequence } from './boot-sequence';

interface BootGateProps {
  children: React.ReactNode;
  battlefieldCount: number;
  inCombatCount: number;
}

/**
 * Shows the boot animation on first visit to the app.
 * Uses sessionStorage so it only plays once per browser session.
 * Works on any page — just wrap the content.
 */
export function BootGate({ children, battlefieldCount, inCombatCount }: BootGateProps) {
  const [booted, setBooted] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('devroom-booted') === 'true') {
      setBooted(true);
    }
    setChecked(true);
  }, []);

  const handleBootComplete = useCallback(() => {
    setBooted(true);
    sessionStorage.setItem('devroom-booted', 'true');
  }, []);

  // Don't render until we've checked sessionStorage (avoids hydration flash)
  if (!checked) return null;

  if (!booted) {
    return (
      <BootSequence
        battlefieldCount={battlefieldCount}
        inCombatCount={inCombatCount}
        onComplete={handleBootComplete}
      />
    );
  }

  return <>{children}</>;
}
