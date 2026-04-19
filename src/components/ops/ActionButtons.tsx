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

function tooltip(status: OpsStatus, name: ActionName, enabled: boolean): string {
  if (status.isSelfControlled) return 'self-control locked — use terminal';
  if (!enabled) {
    if (status.state === 'stopped') return 'service offline';
    if (name === 'ENGAGE PROD') return 'already in PROD';
    if (name === 'ENGAGE DEV') return 'already in DEV';
    if (name === 'DEPLOY') return 'already running';
  }
  return '';
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

  const lifecycleBtn = (name: 'DEPLOY' | 'STAND DOWN' | 'REBOOT', intent: 'go' | 'halt' | 'cycle', glyph: string) => {
    const on = enabled[name];
    const isConfirm = confirm === name;
    const palette =
      intent === 'halt'
        ? { border: 'border-red-500/60', text: 'text-red-400', hover: 'hover:bg-red-500/10 hover:border-red-400 hover:shadow-[0_0_24px_-4px_rgba(239,68,68,0.7),inset_0_0_24px_-8px_rgba(239,68,68,0.4)]', stripe: 'bg-red-500' }
        : intent === 'go'
          ? { border: 'border-green-500/60', text: 'text-green-400', hover: 'hover:bg-green-500/10 hover:border-green-400 hover:shadow-[0_0_24px_-4px_rgba(34,197,94,0.7),inset_0_0_24px_-8px_rgba(34,197,94,0.4)]', stripe: 'bg-green-500' }
          : { border: 'border-amber-500/60', text: 'text-amber-400', hover: 'hover:bg-amber-500/10 hover:border-amber-400 hover:shadow-[0_0_24px_-4px_rgba(245,158,11,0.7),inset_0_0_24px_-8px_rgba(245,158,11,0.4)]', stripe: 'bg-amber-500' };
    return (
      <button
        key={name}
        disabled={!on || pending}
        onClick={() => click(name)}
        title={tooltip(status, name, on)}
        data-testid={`ops-action-${name.replace(/\s+/g, '-').toLowerCase()}`}
        className={[
          'group relative flex-1 min-w-[200px] h-[130px] border-2 tracking-[0.2em] uppercase text-sm font-bold',
          'transition-all duration-150 font-mono flex flex-col items-center justify-center gap-2',
          'active:translate-y-[1px]',
          on
            ? isConfirm
              ? 'border-red-500 text-red-400 bg-red-500/15 animate-pulse shadow-[0_0_30px_-4px_rgba(239,68,68,0.8),inset_0_0_30px_-8px_rgba(239,68,68,0.5)]'
              : `${palette.border} ${palette.text} bg-zinc-950/50 ${palette.hover}`
            : 'border-zinc-800 text-zinc-700 cursor-not-allowed bg-zinc-950/30',
        ].join(' ')}
      >
        {/* corner brackets */}
        <span className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-current opacity-80" />
        <span className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-current opacity-80" />
        <span className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-current opacity-80" />
        <span className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-current opacity-80" />
        {/* left accent stripe */}
        {on && <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${isConfirm ? 'bg-red-500' : palette.stripe} opacity-60 group-hover:opacity-100 transition-opacity`} />}
        <span className="text-2xl leading-none opacity-80 group-hover:opacity-100">{glyph}</span>
        <span className={`text-xs tracking-[0.3em] ${!on ? 'line-through' : ''}`}>{isConfirm ? `CONFIRM` : name}</span>
      </button>
    );
  };

  const modeSegment = (name: 'ENGAGE PROD' | 'ENGAGE DEV', active: boolean) => {
    const on = enabled[name];
    const isConfirm = confirm === name;
    return (
      <button
        key={name}
        disabled={!on || pending}
        onClick={() => click(name)}
        title={tooltip(status, name, on)}
        data-testid={`ops-action-${name.replace(/\s+/g, '-').toLowerCase()}`}
        className={[
          'flex-1 tracking-[0.25em] uppercase text-xs font-bold transition-all duration-150 font-mono',
          active
            ? 'bg-amber-500/20 text-amber-300 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.8),inset_0_0_24px_-4px_rgba(245,158,11,0.5)]'
            : on
              ? isConfirm
                ? 'bg-red-500/10 text-red-400 animate-pulse'
                : 'text-zinc-400 hover:bg-amber-500/5 hover:text-amber-400'
              : 'text-zinc-700 line-through cursor-not-allowed',
        ].join(' ')}
      >
        {isConfirm ? `CONFIRM` : name}
      </button>
    );
  };

  return (
    <div className="flex gap-8 font-mono items-stretch flex-wrap">
      {/* LIFECYCLE group */}
      <div className="flex-1 basis-0 min-w-[480px] flex flex-col">
        <div className="flex items-center gap-3 mb-4 text-[10px] tracking-[0.4em] text-zinc-500">
          <span>:: LIFECYCLE</span>
          <span className="flex-1 h-px bg-gradient-to-l from-transparent via-zinc-800 to-zinc-800" />
        </div>
        <div className="flex gap-3 flex-1">
          {lifecycleBtn('DEPLOY', 'go', '▶')}
          {lifecycleBtn('STAND DOWN', 'halt', '■')}
          {lifecycleBtn('REBOOT', 'cycle', '↻')}
        </div>
      </div>

      {/* MODE group */}
      <div className="flex-1 basis-0 min-w-[280px] flex flex-col">
        <div className="flex items-center gap-3 mb-4 text-[10px] tracking-[0.4em] text-zinc-500">
          <span>:: MODE</span>
          <span className="flex-1 h-px bg-gradient-to-l from-transparent via-zinc-800 to-zinc-800" />
        </div>
        <div className="flex-1 flex flex-col border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800 min-h-[130px]">
          {modeSegment('ENGAGE PROD', status.mode === 'prod')}
          {modeSegment('ENGAGE DEV', status.mode === 'dev')}
        </div>
      </div>
    </div>
  );
}
