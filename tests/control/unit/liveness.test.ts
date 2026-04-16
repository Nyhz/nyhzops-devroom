import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { attachLivenessMonitor, LivenessEvent } from '@/control/liveness';

function makeFakeProcess(): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess;
  (ee as any).kill = vi.fn();
  return ee;
}

describe('attachLivenessMonitor', () => {
  it('fires exit event when child process closes', () => {
    vi.useFakeTimers();
    const events: LivenessEvent[] = [];
    const proc = makeFakeProcess();
    attachLivenessMonitor(proc, { stdoutSilenceMs: 5000, hardTimeoutMs: 30000, onEvent: e => events.push(e) });
    (proc as unknown as EventEmitter).emit('close', 0, null);
    expect(events).toEqual([{ type: 'exit', code: 0, signal: null }]);
    vi.useRealTimers();
  });

  it('fires silence-kill after stdoutSilenceMs of no notifyStdout', () => {
    vi.useFakeTimers();
    const events: LivenessEvent[] = [];
    const proc = makeFakeProcess();
    attachLivenessMonitor(proc, { stdoutSilenceMs: 5000, hardTimeoutMs: 30000, onEvent: e => events.push(e) });
    vi.advanceTimersByTime(4999);
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(events.some(e => e.type === 'silence-kill')).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('notifyStdout resets silence timer', () => {
    vi.useFakeTimers();
    const events: LivenessEvent[] = [];
    const proc = makeFakeProcess();
    const mon = attachLivenessMonitor(proc, { stdoutSilenceMs: 5000, hardTimeoutMs: 30000, onEvent: e => events.push(e) });
    vi.advanceTimersByTime(4000);
    mon.notifyStdout();
    vi.advanceTimersByTime(4000);
    expect(events.length).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(events.some(e => e.type === 'silence-kill')).toBe(true);
    vi.useRealTimers();
  });

  it('fires timeout after hardTimeoutMs regardless of activity', () => {
    vi.useFakeTimers();
    const events: LivenessEvent[] = [];
    const proc = makeFakeProcess();
    const mon = attachLivenessMonitor(proc, { stdoutSilenceMs: 5000, hardTimeoutMs: 10000, onEvent: e => events.push(e) });
    for (let t = 0; t < 10000; t += 1000) {
      mon.notifyStdout();
      vi.advanceTimersByTime(1000);
    }
    mon.notifyStdout(); vi.advanceTimersByTime(1);
    expect(events.some(e => e.type === 'timeout')).toBe(true);
    vi.useRealTimers();
  });

  it('dispose cancels all pending timers', () => {
    vi.useFakeTimers();
    const events: LivenessEvent[] = [];
    const proc = makeFakeProcess();
    const mon = attachLivenessMonitor(proc, { stdoutSilenceMs: 5000, hardTimeoutMs: 30000, onEvent: e => events.push(e) });
    mon.dispose();
    vi.advanceTimersByTime(60000);
    expect(events).toHaveLength(0);
    vi.useRealTimers();
  });
});
