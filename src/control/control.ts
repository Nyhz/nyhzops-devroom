import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { missions } from '@/lib/db/schema';
import { getControlConfig } from './config';
import { emitComm } from './comms';
import { sweepStaleMissions } from './watchdog';
import { runMission, type MissionRunnerDeps } from './mission-runner';
import { onMissionTerminal } from './campaign/executor';

/**
 * Task 2.10 scaffold — dispatch loop, slot accounting, startup recovery.
 *
 * The `Control` class owns:
 *   - A slot-limited loop that picks QUEUED missions and hands them to
 *     `runMission()` up to `getControlConfig().maxAgents` concurrently.
 *   - A `livePids` map (missionId -> pid) populated by the mission-runner
 *     once the subprocess is spawned. Used by the watchdog for L6 sweeps.
 *   - A periodic watchdog timer that calls `sweepStaleMissions`.
 *   - `pauseAll` / `resumeAll` for AUTH failures and Commander controls.
 *
 * The actual subprocess spawn, classification fallback, merge logic, and
 * OVERSEER/QUARTERMASTER paths live in the `MissionRunnerDeps` injected into
 * `start()`. Later phases (3, 4, 5, 6) supply real implementations; this
 * scaffold exists so its contract can be unit-tested with mocked deps.
 */

export interface ControlOptions {
  /** Dependencies forwarded to each mission-runner invocation. */
  missionDeps: Omit<MissionRunnerDeps, 'onPidAssigned'>;
  /** Clock injection (testable). */
  now?: () => number;
  /** Poll interval when no mission is ready. Short in tests. */
  idlePollMs?: number;
  /** Watchdog tick cadence. */
  watchdogIntervalMs?: number;
}

export class Control {
  private running = false;
  private paused = false;
  private watchdogTimer: NodeJS.Timeout | null = null;
  /** missionId -> pid (0 until the runner reports one). */
  readonly live = new Map<string, number>();
  /** Tracks currently-dispatching missionIds so the loop never double-picks. */
  private readonly dispatched = new Set<string>();
  /** In-flight dispatch promises, awaited by stop() so the live map drains. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly opts: ControlOptions) {}

  /** Begin dispatch. Returns once startup recovery completes and the loop
   *  has been scheduled. Loop continues until `stop()` resolves. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const now = this.opts.now ?? (() => Date.now());

    // Startup recovery — heal anything CONTROL thinks is live that isn't.
    await sweepStaleMissions({
      livePids: this.live,
      now,
      staleThresholdMs: getControlConfig().attemptHardTimeoutMs,
    });

    this.watchdogTimer = setInterval(() => {
      sweepStaleMissions({
        livePids: this.live,
        now,
        staleThresholdMs: getControlConfig().attemptHardTimeoutMs,
      }).catch((err) => {
        emitComm({
          actor: 'CONTROL',
          message: `Watchdog sweep error: ${(err as Error).message}`,
          level: 'error',
        });
      });
    }, this.opts.watchdogIntervalMs ?? 60_000);

    // Fire and forget the loop.
    void this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    // Drain in-flight dispatches so callers observing `live` see the cleared
    // state. Missions themselves run to completion — we never abort them from
    // here; that's the watchdog / commander's job.
    await Promise.allSettled([...this.inFlight]);
  }

  /**
   * Send SIGTERM (then SIGKILL after 5s) to the Claude subprocess running the
   * given mission, if any. Returns true if a pid was known and signaled.
   *
   * Used by the `abandonMission` Server Action so the Commander's click
   * actually stops the running agent — setting status=abandoned in the DB
   * doesn't interrupt stdout streaming by itself.
   */
  killMission(missionId: string): boolean {
    const pid = this.live.get(missionId);
    if (!pid || pid === 0) return false;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return false;
    }
    setTimeout(() => {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }, 5000).unref?.();
    emitComm({
      missionId,
      actor: 'CONTROL',
      message: `Killed live process pid=${pid}`,
      level: 'warn',
    });
    return true;
  }

  pauseAll(reason: string): void {
    this.paused = true;
    emitComm({ message: `Orchestrator paused: ${reason}`, level: 'warn' });
  }

  resumeAll(): void {
    this.paused = false;
    emitComm({ message: 'Orchestrator resumed.' });
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Execute a single dispatch tick — picks up to (maxAgents - live) missions
   *  and hands each to `runMission`. Exposed for tests so they don't have to
   *  drive the polling loop manually. */
  async tick(): Promise<number> {
    if (this.paused) return 0;
    const cfg = getControlConfig();
    let dispatched = 0;
    while (this.dispatched.size < cfg.maxAgents) {
      const next = this.pickQueuedMission();
      if (!next) break;
      if (this.dispatched.has(next.id)) break;
      this.dispatched.add(next.id);
      this.live.set(next.id, 0);
      dispatched++;
      const p = this.dispatchMission(next.id).finally(() => {
        this.inFlight.delete(p);
      });
      this.inFlight.add(p);
    }
    return dispatched;
  }

  private async dispatchMission(missionId: string): Promise<void> {
    const deps: MissionRunnerDeps = {
      ...this.opts.missionDeps,
      onPidAssigned: (pid) => this.live.set(missionId, pid),
    };
    try {
      await runMission(missionId, deps);
    } catch (err) {
      emitComm({
        missionId,
        message: `Mission runner crashed: ${(err as Error).message}`,
        level: 'error',
      });
    } finally {
      this.live.delete(missionId);
      this.dispatched.delete(missionId);
      // Wire mission completion back to campaign phase advancement.
      // Without this, settlePhase / activatePhase only ever fire from the
      // manual Accept-and-Merge or Abandon UI paths — natural happy-path
      // completions (clean gates → clean merge → ACCOMPLISHED) leave the
      // phase stuck in ACTIVE and the next phase never wakes up.
      // onMissionTerminal returns early for standalone missions and only
      // settles when ALL phase missions are terminal, so it is safe to
      // call unconditionally after runMission resolves.
      try {
        onMissionTerminal(missionId);
      } catch (err) {
        emitComm({
          missionId,
          message: `Phase advancement failed: ${(err as Error).message}`,
          level: 'error',
        });
      }
    }
  }

  private async loop(): Promise<void> {
    const idle = this.opts.idlePollMs ?? 1000;
    while (this.running) {
      await this.tick();
      await sleep(idle);
    }
  }

  private pickQueuedMission() {
    const db = getDatabase();
    const now = (this.opts.now ?? (() => Date.now()))();
    const rows = db
      .select()
      .from(missions)
      .where(
        and(
          eq(missions.status, 'queued'),
          or(isNull(missions.nextAttemptAt), lte(missions.nextAttemptAt, now)),
        ),
      )
      .all();
    // Exclude missions we've already handed off this cycle — status update in
    // the runner is async and may not be visible yet.
    for (const r of rows) {
      if (!this.dispatched.has(r.id) && !this.live.has(r.id)) return r;
    }
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
