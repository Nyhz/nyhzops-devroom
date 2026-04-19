import { parseLaunchctlPrint, parsePsOutput } from './parsers';
import type { ManagedApp, OpsStatus, HealthInfo } from './types';

export interface OpsPollerDeps {
  listApps: () => ManagedApp[];
  runLaunchctl: (label: string) => Promise<string>;
  runPs: (pid: number) => Promise<string>;
  probeHealth: (url: string | null) => Promise<HealthInfo>;
  readMode: (slug: string) => 'prod' | 'dev' | 'unknown';
  writeMetric: (row: {
    slug: string; ts: number; bucket: 'raw'; rss: number | null;
    cpu: number | null; healthy: boolean | null; httpCode: number | null; latencyMs: number | null;
  }) => void;
  emit: (snapshot: OpsStatus[]) => void;
  now: () => number;
}

export class OpsPoller {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processStartTimes = new Map<string, number>();
  private lastSnapshot: OpsStatus[] = [];

  constructor(private deps: OpsPollerDeps) {}

  start(intervalMs = 3000): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      if (this.running) return;
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): OpsStatus[] {
    return this.lastSnapshot;
  }

  async tick(): Promise<void> {
    this.running = true;
    try {
      const apps = this.deps.listApps();
      const results = await Promise.all(apps.map((app) => this.pollApp(app)));
      this.lastSnapshot = results;
      this.deps.emit(results);
      for (const r of results) {
        this.deps.writeMetric({
          slug: r.slug,
          ts: r.lastUpdatedAt,
          bucket: 'raw',
          rss: r.rssBytes,
          cpu: r.cpuPercent,
          healthy: r.healthy,
          httpCode: r.httpCode,
          latencyMs: r.latencyMs,
        });
      }
    } finally {
      this.running = false;
    }
  }

  private async pollApp(app: ManagedApp): Promise<OpsStatus> {
    const now = this.deps.now();
    const raw = await this.deps.runLaunchctl(app.launchdLabel).catch(() => '');
    const { pid, lastExitCode } = parseLaunchctlPrint(raw);
    let rss: number | null = null;
    let cpu: number | null = null;
    if (pid) {
      const psOut = await this.deps.runPs(pid).catch(() => '');
      const proc = parsePsOutput(psOut);
      if (proc) { rss = proc.rssBytes; cpu = proc.cpuPercent; }
      if (!this.processStartTimes.has(`${app.slug}:${pid}`)) {
        this.processStartTimes.set(`${app.slug}:${pid}`, now);
      }
    } else {
      for (const k of this.processStartTimes.keys()) {
        if (k.startsWith(`${app.slug}:`)) this.processStartTimes.delete(k);
      }
    }
    const health = await this.deps.probeHealth(app.healthUrl ?? null);
    const mode = this.deps.readMode(app.slug);
    const uptimeStart = pid ? this.processStartTimes.get(`${app.slug}:${pid}`) ?? now : null;
    const state: OpsStatus['state'] =
      !pid ? 'stopped' : health.healthy ? 'running' : 'unresponsive';

    return {
      slug: app.slug,
      displayName: app.displayName,
      mode,
      pid,
      lastExitCode,
      uptimeMs: uptimeStart ? now - uptimeStart : null,
      rssBytes: rss,
      cpuPercent: cpu,
      healthy: pid ? health.healthy : null,
      httpCode: health.httpCode,
      latencyMs: health.latencyMs,
      state,
      isSelfControlled: app.isSelfControlled,
      lastUpdatedAt: now,
      sinceMs: null,
    };
  }
}
