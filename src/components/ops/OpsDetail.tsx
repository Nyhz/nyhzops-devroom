'use client';
import { useState } from 'react';
import { ActionButtons } from './ActionButtons';
import { Sparkline } from './Sparkline';
import { OpsLogTerminal } from './OpsLogTerminal';
import type { OpsStatus, ActionResult } from '@/lib/ops/types';
import { startApp, stopApp, restartApp, setMode } from '@/actions/ops';

export interface MetricPoint {
  ts: number;
  rss: number | null;
  cpu: number | null;
  latency: number | null;
}

export function OpsDetail({
  status, metrics,
}: { status: OpsStatus; metrics: MetricPoint[] }) {
  const [toast, setToast] = useState<string | null>(null);
  const onResult = (r: ActionResult) =>
    setToast(r.ok ? 'OK' : `ERR: ${r.error}${r.stderrTail ? ' — ' + r.stderrTail : ''}`);

  return (
    <div className="mt-6 border border-zinc-800 p-4 space-y-6 font-mono">
      <ActionButtons
        status={status}
        actions={{ start: startApp, stop: stopApp, restart: restartApp, setMode }}
        onResult={onResult}
      />
      {toast && <div className="text-xs text-amber-500">{toast}</div>}
      <section>
        <h3 className="text-amber-500 text-xs mb-2 tracking-widest">TELEMETRY</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div>PID :: <span className="text-green-400">{status.pid ?? '—'}</span></div>
          <div>EXIT :: <span className="text-green-400">{status.lastExitCode ?? '—'}</span></div>
          <div>HTTP :: <span className="text-green-400">{status.httpCode ?? '—'}</span></div>
          <div>LATENCY :: <span className="text-green-400">{status.latencyMs ?? '—'} ms</span></div>
        </dl>
      </section>
      <section className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-amber-500 tracking-widest">RSS</div>
          <Sparkline points={metrics.map((m) => ({ ts: m.ts, value: m.rss }))} />
        </div>
        <div>
          <div className="text-xs text-amber-500 tracking-widest">CPU</div>
          <Sparkline points={metrics.map((m) => ({ ts: m.ts, value: m.cpu }))} />
        </div>
        <div>
          <div className="text-xs text-amber-500 tracking-widest">LATENCY</div>
          <Sparkline points={metrics.map((m) => ({ ts: m.ts, value: m.latency }))} />
        </div>
      </section>
      <OpsLogTerminal slug={status.slug} />
    </div>
  );
}
