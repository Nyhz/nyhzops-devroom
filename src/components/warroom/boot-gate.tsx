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
 *
 * Starts with showOverlay=true on both server and client to avoid hydration mismatch,
 * then checks sessionStorage in useEffect to skip the animation if already booted.
 */
export function BootGate({ children, battlefieldCount, inCombatCount }: BootGateProps) {
  const [checked, setChecked] = useState(false);
  const [shouldBoot, setShouldBoot] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('devroom-booted') !== 'true') {
      setShouldBoot(true);
    }
    setChecked(true);
  }, []);

  const handleBootComplete = useCallback(() => {
    sessionStorage.setItem('devroom-booted', 'true');
    setShouldBoot(false);
  }, []);

  return (
    <>
      {children}
      {checked && shouldBoot && (
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
