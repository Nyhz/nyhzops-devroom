'use client';

import { useState, useEffect, useTransition } from 'react';
import { TacButton } from '@/components/ui/tac-button';
import { cn } from '@/lib/utils';
import { runAudit } from '@/actions/deps';
import type { AuditResult } from '@/types';

interface DepsAuditProps {
  battlefieldId: string;
  className?: string;
}

const SEVERITY_CONFIG = {
  critical: { label: 'CRITICAL', bg: 'bg-dr-red/20', border: 'border-dr-red/40', text: 'text-dr-red', badge: 'bg-dr-red text-dr-bg' },
  high: { label: 'HIGH', bg: 'bg-dr-red/10', border: 'border-dr-red/30', text: 'text-dr-red', badge: 'bg-dr-red/80 text-dr-bg' },
  moderate: { label: 'MODERATE', bg: 'bg-dr-amber/10', border: 'border-dr-amber/30', text: 'text-dr-amber', badge: 'bg-dr-amber text-dr-bg' },
  low: { label: 'LOW', bg: 'bg-dr-dim/10', border: 'border-dr-border', text: 'text-dr-dim', badge: 'bg-dr-dim/30 text-dr-dim' },
} as const;

export function DepsAudit({ battlefieldId, className }: DepsAuditProps) {
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function fetchAudit() {
    setError(null);
    startTransition(async () => {
      try {
        const data = await runAudit(battlefieldId);
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Audit failed');
      }
    });
  }

  useEffect(() => {
    fetchAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battlefieldId]);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center gap-3">
        <TacButton
          size="sm"
          variant="ghost"
          onClick={fetchAudit}
          disabled={isPending}
        >
          {isPending ? 'SCANNING...' : 'RUN AUDIT'}
        </TacButton>
      </div>

      {error && (
        <div className="border border-dr-red/40 bg-dr-red/10 px-4 py-3 text-dr-red text-xs font-mono">
          {error}
        </div>
      )}

      {isPending && !result && (
        <div className="text-dr-dim text-xs font-mono animate-pulse">
          Running security audit...
        </div>
      )}

      {result && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(Object.keys(SEVERITY_CONFIG) as Array<keyof typeof SEVERITY_CONFIG>).map((sev) => {
              const config = SEVERITY_CONFIG[sev];
              const count = result.summary[sev];
              return (
                <div
                  key={sev}
                  className={cn(
                    'border px-4 py-3 text-center',
                    config.bg,
                    config.border,
                  )}
                >
                  <div className={cn('text-2xl font-mono font-bold', config.text)}>
                    {count}
                  </div>
                  <div className={cn('text-xs font-tactical tracking-wider mt-1', config.text)}>
                    {config.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Vulnerability list or success */}
          {result.vulnerabilities.length === 0 ? (
            <div className="border border-dr-green/40 bg-dr-green/10 px-4 py-3 text-dr-green text-xs font-mono">
              No known vulnerabilities detected.
            </div>
          ) : (
            <div className="space-y-2">
              {result.vulnerabilities.map((vuln, i) => (
                <div
                  key={`${vuln.name}-${i}`}
                  className="border border-dr-border bg-dr-surface px-4 py-3 flex items-start gap-3"
                >
                  <span
                    className={cn(
                      'text-[10px] font-tactical tracking-wider px-2 py-0.5 uppercase shrink-0',
                      SEVERITY_CONFIG[vuln.severity as keyof typeof SEVERITY_CONFIG]?.badge
                        ?? SEVERITY_CONFIG.low.badge,
                    )}
                  >
                    {vuln.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-dr-text text-sm font-mono">{vuln.name}</span>
                    <span className="text-dr-dim text-xs ml-2">{vuln.title}</span>
                  </div>
                  {vuln.url && (
                    <a
                      href={vuln.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-dr-amber text-xs hover:underline shrink-0"
                    >
                      DETAILS
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
