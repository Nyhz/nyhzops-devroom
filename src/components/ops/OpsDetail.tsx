'use client';
import { useState } from 'react';
import { ActionButtons } from './ActionButtons';
import { OpsLogTerminal } from './OpsLogTerminal';
import type { OpsStatus, ActionResult } from '@/lib/ops/types';
import { startApp, stopApp, restartApp, setMode } from '@/actions/ops';

function formatUptime(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function toneText(tone: 'green' | 'amber' | 'red' | 'dim'): string {
  return tone === 'red' ? 'text-red-400'
    : tone === 'amber' ? 'text-amber-400'
    : tone === 'dim' ? 'text-zinc-600'
    : 'text-green-400';
}

function StateHero({ state }: { state: 'running' | 'stopped' | 'unresponsive' }) {
  const tone = state === 'running' ? 'green' : state === 'unresponsive' ? 'amber' : 'dim';
  const ring =
    state === 'running' ? 'border-green-500/60 shadow-[0_0_40px_-8px_rgba(34,197,94,0.6),inset_0_0_40px_-16px_rgba(34,197,94,0.3)]'
    : state === 'unresponsive' ? 'border-amber-500/60 shadow-[0_0_40px_-8px_rgba(245,158,11,0.6),inset_0_0_40px_-16px_rgba(245,158,11,0.3)]'
    : 'border-zinc-700';
  const dotColor =
    state === 'running' ? 'bg-green-500 shadow-[0_0_14px_rgba(34,197,94,0.9)]'
    : state === 'unresponsive' ? 'bg-amber-500 shadow-[0_0_14px_rgba(245,158,11,0.9)]'
    : 'bg-zinc-700';

  return (
    <div className={`relative flex flex-col items-center justify-center border-2 bg-zinc-950/50 h-[160px] w-[200px] ${ring}`}>
      <span className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/50" />
      <span className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/50" />
      <span className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-amber-500/50" />
      <span className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-amber-500/50" />
      <span className="absolute top-3 text-[9px] tracking-[0.4em] text-zinc-500">:: STATE ::</span>
      <span className={`w-4 h-4 rounded-full ${dotColor} mb-2 ${state === 'running' ? 'animate-pulse' : ''}`} />
      <span className={`text-xl tracking-[0.3em] font-bold ${toneText(tone)}`}>
        {state.toUpperCase()}
      </span>
    </div>
  );
}

function Instrument({ label, value, tone = 'green', big = false }: { label: string; value: string; tone?: 'green' | 'amber' | 'red' | 'dim'; big?: boolean }) {
  return (
    <div className="relative border border-zinc-800 bg-zinc-950/40 px-4 py-3 flex flex-col justify-between">
      <span className="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l border-amber-500/50" />
      <span className="absolute top-0 right-0 w-1.5 h-1.5 border-t border-r border-amber-500/50" />
      <span className="absolute bottom-0 left-0 w-1.5 h-1.5 border-b border-l border-amber-500/50" />
      <span className="absolute bottom-0 right-0 w-1.5 h-1.5 border-b border-r border-amber-500/50" />
      <div className="text-[9px] tracking-[0.35em] text-zinc-500 uppercase">{label}</div>
      <div className={`font-mono tabular-nums ${big ? 'text-2xl' : 'text-xl'} ${toneText(tone)}`}>
        {value}
      </div>
    </div>
  );
}

function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="relative border border-zinc-800/80 bg-zinc-950/30 p-4">
      <span className="absolute -top-px left-3 px-2 bg-background text-[10px] tracking-[0.35em] text-amber-500">
        {title}
      </span>
      <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-amber-500/60" />
      <span className="absolute top-0 right-0 w-2 h-2 border-t border-r border-amber-500/60" />
      <span className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-amber-500/60" />
      <span className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-amber-500/60" />
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function OpsDetail({ status }: { status: OpsStatus }) {
  const [toast, setToast] = useState<string | null>(null);
  const onResult = (r: ActionResult) =>
    setToast(r.ok ? 'ACK' : `ERR: ${r.error}${r.stderrTail ? ' — ' + r.stderrTail : ''}`);

  const httpTone =
    status.httpCode == null ? 'dim' :
    status.httpCode >= 500 ? 'red' :
    status.httpCode >= 400 ? 'amber' : 'green';
  const latencyTone =
    status.latencyMs == null ? 'dim' :
    status.latencyMs > 500 ? 'red' :
    status.latencyMs > 150 ? 'amber' : 'green';

  return (
    <div className="mt-6 space-y-5 font-mono">
      {/* Callsign header */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-4">
          <span className={`w-2.5 h-2.5 rounded-full ${
            status.state === 'running' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]' :
            status.state === 'unresponsive' ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]' :
            'bg-zinc-700'
          }`} />
          <div className="text-xl tracking-[0.3em] text-amber-500">{status.displayName}</div>
          <div className="text-[10px] tracking-[0.3em] text-zinc-500">
            {status.state.toUpperCase()} · {status.mode.toUpperCase()}
            {status.isSelfControlled && ' · SELF'}
          </div>
        </div>
        {toast && (
          <div className={`text-xs tracking-widest px-2 py-1 border ${
            toast === 'ACK'
              ? 'border-green-500/50 text-green-400 bg-green-500/5'
              : 'border-red-500/50 text-red-400 bg-red-500/5'
          }`}>
            {toast}
          </div>
        )}
      </div>

      {status.isSelfControlled ? (
        <SectionFrame title="ACTION CONSOLE :: LOCKED">
          <div className="flex items-center gap-3 text-xs tracking-widest text-zinc-500 py-2">
            <span className="w-2 h-2 rounded-full bg-red-500/70 shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
            <span>SELF-CONTROLLED — USE TERMINAL (`devroom` CLI)</span>
          </div>
        </SectionFrame>
      ) : (
        <SectionFrame title="ACTION CONSOLE">
          <ActionButtons
            status={status}
            actions={{ start: startApp, stop: stopApp, restart: restartApp, setMode }}
            onResult={onResult}
          />
        </SectionFrame>
      )}

      <SectionFrame title="TELEMETRY">
        <div className="flex gap-4 items-stretch">
          <StateHero state={status.state} />
          <div className="flex-1 grid grid-cols-2 gap-3 min-w-0">
            <Instrument
              label="PID"
              value={status.pid != null ? String(status.pid) : '—'}
              tone={status.pid ? 'green' : 'dim'}
              big
            />
            <Instrument
              label="UPTIME"
              value={formatUptime(status.uptimeMs)}
              tone={status.uptimeMs ? 'green' : 'dim'}
              big
            />
            <Instrument
              label="HTTP"
              value={status.httpCode != null ? String(status.httpCode) : '—'}
              tone={httpTone}
              big
            />
            <Instrument
              label="LATENCY"
              value={status.latencyMs != null ? `${status.latencyMs} ms` : '—'}
              tone={latencyTone}
              big
            />
          </div>
        </div>
      </SectionFrame>

      <SectionFrame title="COMMS">
        <OpsLogTerminal slug={status.slug} />
      </SectionFrame>
    </div>
  );
}
