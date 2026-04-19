'use client';
import { useState, useTransition } from 'react';
import type { OpsStatus, ActionResult } from '@/lib/ops/types';

type ActionName = 'DEPLOY' | 'STAND DOWN' | 'REBOOT' | 'ENGAGE PROD' | 'ENGAGE DEV';

interface Props {
  status: OpsStatus;
  actions: {
    start: (slug: string) => Promise<ActionResult>;
    stop: (slug: string) => Promise<ActionResult>;
    restart: (slug: string) => Promise<ActionResult>;
    setMode: (slug: string, mode: 'prod' | 'dev') => Promise<ActionResult>;
  };
  onResult: (r: ActionResult) => void;
}

function enabledSet(s: OpsStatus): Record<ActionName, boolean> {
  if (s.isSelfControlled) {
    return { 'DEPLOY': false, 'STAND DOWN': false, 'REBOOT': false, 'ENGAGE PROD': false, 'ENGAGE DEV': false };
  }
  const running = s.state !== 'stopped';
  return {
    'DEPLOY': !running,
    'STAND DOWN': running,
    'REBOOT': running,
    'ENGAGE PROD': running && s.mode === 'dev',
    'ENGAGE DEV': running && s.mode === 'prod',
  };
}

export function ActionButtons({ status, actions, onResult }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<ActionName | null>(null);
  const enabled = enabledSet(status);

  const run = (name: ActionName) => startTransition(async () => {
    let r: ActionResult;
    switch (name) {
      case 'DEPLOY': r = await actions.start(status.slug); break;
      case 'STAND DOWN': r = await actions.stop(status.slug); break;
      case 'REBOOT': r = await actions.restart(status.slug); break;
      case 'ENGAGE PROD': r = await actions.setMode(status.slug, 'prod'); break;
      case 'ENGAGE DEV': r = await actions.setMode(status.slug, 'dev'); break;
    }
    onResult(r);
    setConfirm(null);
  });

  const click = (name: ActionName) => {
    if (!enabled[name] || pending) return;
    if (confirm === name) { run(name); return; }
    setConfirm(name);
    setTimeout(() => setConfirm((c) => (c === name ? null : c)), 3000);
  };

  const tooltip = (name: ActionName): string => {
    if (status.isSelfControlled) return 'self-control locked — use terminal';
    if (!enabled[name]) {
      if (status.state === 'stopped') return 'service offline';
      if (name === 'ENGAGE PROD') return 'already in PROD';
      if (name === 'ENGAGE DEV') return 'already in DEV';
      if (name === 'DEPLOY') return 'already running';
    }
    return '';
  };

  return (
    <div className="flex gap-2 font-mono text-xs flex-wrap">
      {(['DEPLOY', 'STAND DOWN', 'REBOOT', 'ENGAGE PROD', 'ENGAGE DEV'] as ActionName[]).map((name) => {
        const on = enabled[name];
        const isConfirm = confirm === name;
        return (
          <button
            key={name}
            disabled={!on || pending}
            onClick={() => click(name)}
            title={tooltip(name)}
            data-testid={`ops-action-${name.replace(/\s+/g, '-').toLowerCase()}`}
            className={[
              'px-3 py-1 border tracking-widest uppercase transition-colors',
              on
                ? isConfirm
                  ? 'border-red-500 text-red-500 animate-pulse'
                  : 'border-amber-500 text-amber-500 hover:bg-amber-500/10'
                : 'border-zinc-700 text-zinc-600 line-through cursor-not-allowed',
            ].join(' ')}
          >
            {isConfirm ? `CONFIRM ${name}` : name}
          </button>
        );
      })}
    </div>
  );
}
