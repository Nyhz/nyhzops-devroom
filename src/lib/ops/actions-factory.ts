import type { CtlRunner } from '@/lib/ops/ctl';
import type { ActionResult, ManagedApp } from '@/lib/ops/types';

export interface OpsDeps {
  getApp: (slug: string) => ManagedApp | null;
  runner: CtlRunner;
  revalidate: (path: string) => void;
}

async function invoke(deps: OpsDeps, slug: string, sub: string): Promise<ActionResult> {
  const app = deps.getApp(slug);
  if (!app) return { ok: false, error: 'unknown slug' };
  if (app.isSelfControlled) return { ok: false, error: 'self-control locked — use terminal' };
  const { exitCode, stdout, stderr } = await deps.runner.run(app.ctlScriptPath, [sub], 30_000);
  const stdoutTail = stdout.trim().split('\n').slice(-5).join('\n');
  const stderrTail = stderr.trim().split('\n').slice(-5).join('\n');
  if (exitCode !== 0) return { ok: false, error: `ctl ${sub} exited ${exitCode}`, stdoutTail, stderrTail };
  deps.revalidate('/ops');
  return { ok: true, stdoutTail, stderrTail };
}

/** @internal — exported for tests only. */
export function _makeOpsActions(deps: OpsDeps) {
  return {
    startApp: (slug: string) => invoke(deps, slug, 'start'),
    stopApp: (slug: string) => invoke(deps, slug, 'stop'),
    restartApp: (slug: string) => invoke(deps, slug, 'restart'),
    setMode: (slug: string, mode: 'prod' | 'dev') => invoke(deps, slug, mode),
  };
}
