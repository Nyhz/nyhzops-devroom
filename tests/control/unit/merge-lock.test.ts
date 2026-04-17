import { describe, it, expect } from 'vitest';
import { MergeLockManager } from '@/control/merge';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('MergeLockManager (tail-promise queue)', () => {
  it('serializes acquisitions on the same battlefield in FIFO order', async () => {
    const lm = new MergeLockManager();
    const completed: number[] = [];
    const durations = [5, 20, 1, 10, 3];

    const tasks = durations.map((d, i) =>
      lm.acquire('bfA', async () => {
        await sleep(d);
        completed.push(i);
      }),
    );

    await Promise.all(tasks);
    expect(completed).toEqual([0, 1, 2, 3, 4]);
  });

  it('runs acquisitions on different battlefields in parallel', async () => {
    const lm = new MergeLockManager();
    const start = Date.now();

    await Promise.all([
      lm.acquire('bfA', () => sleep(30)),
      lm.acquire('bfB', () => sleep(30)),
    ]);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(55);
  });

  it('releases the lock when fn throws so subsequent acquirers proceed', async () => {
    const lm = new MergeLockManager();

    const first = lm.acquire('bfA', async () => {
      throw new Error('boom');
    });
    await expect(first).rejects.toThrow('boom');

    let ran = false;
    await lm.acquire('bfA', async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('frees the map entry after the chain drains', async () => {
    const lm = new MergeLockManager();
    await lm.acquire('bfA', async () => {
      // nothing
    });
    // Let the deferred queueMicrotask cleanup run.
    await Promise.resolve();
    await Promise.resolve();
    expect(lm.has('bfA')).toBe(false);
  });
});
