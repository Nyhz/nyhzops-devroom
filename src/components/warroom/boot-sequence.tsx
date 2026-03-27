'use client';

import { useEffect, useState } from 'react';

interface BootSequenceProps {
  battlefieldCount: number;
  inCombatCount: number;
  onComplete: () => void;
}

const BOOT_STEPS = [
  'Establishing secure connection...',
  'Loading battlefield intelligence...',
  'Recovering active campaigns...',
  'Contacting deployed assets...',
] as const;

export function BootSequence({ battlefieldCount, inCombatCount, onComplete }: BootSequenceProps) {
  const [visibleBars, setVisibleBars] = useState(0);
  const [filledBars, setFilledBars] = useState(0);
  const [visibleStatus, setVisibleStatus] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Stagger bar appearances (800ms apart)
    for (let i = 0; i < BOOT_STEPS.length; i++) {
      // Show bar
      timers.push(setTimeout(() => setVisibleBars(i + 1), i * 800));
      // Fill bar 50ms after it appears
      timers.push(setTimeout(() => setFilledBars(i + 1), i * 800 + 50));
    }

    // After all bars filled (~3200ms + 700ms fill), show status lines
    const statusStart = BOOT_STEPS.length * 800 + 700;
    const statusLines = 4;
    for (let i = 0; i < statusLines; i++) {
      timers.push(setTimeout(() => setVisibleStatus(i + 1), statusStart + i * 150));
    }

    // Fade out and call onComplete
    const fadeStart = statusStart + statusLines * 150 + 400;
    timers.push(setTimeout(() => setFading(true), fadeStart));
    timers.push(setTimeout(() => onComplete(), fadeStart + 500));

    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 bg-dr-bg flex items-center justify-center transition-opacity duration-500 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="w-[560px] space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="text-dr-dim font-tactical text-base tracking-[0.4em] uppercase">
            NYHZ OPS
          </div>
          <div className="text-dr-amber font-tactical text-5xl tracking-[0.3em] uppercase">
            DEVROOM
          </div>
          <div className="text-dr-dim font-tactical text-sm tracking-[0.5em] uppercase">
            TACTICAL OPERATIONS CENTER
          </div>
          <div className="mt-4 h-px bg-gradient-to-r from-transparent via-dr-amber/50 to-transparent" />
        </div>

        {/* Progress bars */}
        <div className="space-y-4 mt-10">
          {BOOT_STEPS.map((label, i) => (
            <div
              key={label}
              className={`transition-opacity duration-300 ${
                i < visibleBars ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-dr-muted font-data text-sm">{label}</span>
                <span
                  className={`text-dr-green font-tactical text-sm transition-opacity duration-200 ${
                    i < filledBars ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ transitionDelay: '700ms' }}
                >
                  &#10003;
                </span>
              </div>
              <div className="h-2 w-[200px] bg-dr-elevated overflow-hidden">
                <div
                  className="h-full bg-dr-green transition-all duration-700 ease-linear"
                  style={{
                    width: i < filledBars ? '100%' : '0%',
                    boxShadow: i < filledBars ? '0 0 6px rgba(0, 255, 65, 0.3)' : 'none',
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Status lines */}
        <div className="space-y-2.5 mt-8">
          <div
            className={`font-tactical text-sm tracking-wider transition-opacity duration-200 ${
              visibleStatus >= 1 ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className="text-dr-green">&#9679;</span>
            <span className="text-dr-text ml-3">ALL SYSTEMS OPERATIONAL</span>
          </div>
          <div
            className={`font-tactical text-sm tracking-wider transition-opacity duration-200 ${
              visibleStatus >= 2 ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className="text-dr-green">&#9679;</span>
            <span className="text-dr-text ml-3">{battlefieldCount} BATTLEFIELDS ONLINE</span>
          </div>
          <div
            className={`font-tactical text-sm tracking-wider transition-opacity duration-200 ${
              visibleStatus >= 3 ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className="text-dr-amber">&#9679;</span>
            <span className="text-dr-text ml-3">{inCombatCount} MISSIONS IN COMBAT</span>
          </div>
          <div
            className={`font-tactical text-sm tracking-wider transition-opacity duration-200 ${
              visibleStatus >= 4 ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className="text-dr-green">&#9679;</span>
            <span className="text-dr-text ml-3">CAPTAIN ON STATION</span>
          </div>
        </div>

        {/* Entering command center */}
        <div className="text-center mt-8">
          <span
            className={`text-dr-amber font-tactical text-sm tracking-[0.3em] uppercase animate-pulse transition-opacity duration-300 ${
              visibleStatus >= 4 ? 'opacity-100' : 'opacity-0'
            }`}
          >
            ENTERING COMMAND CENTER
          </span>
        </div>
      </div>
    </div>
  );
}
