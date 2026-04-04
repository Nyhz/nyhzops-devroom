'use client';

import { cn } from '@/lib/utils';

interface TestSummaryProps {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  coveragePercent?: number;
  className?: string;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TestSummary({
  total,
  passed,
  failed,
  skipped,
  durationMs,
  coveragePercent,
  className,
}: TestSummaryProps) {
  return (
    <div className={cn('flex flex-wrap gap-x-5 gap-y-2 font-mono text-sm', className)}>
      <span className="text-dr-text">
        TOTAL: <span className="font-bold">{total}</span>
      </span>
      <span className="text-green-400">
        ✓ PASSED: <span className="font-bold">{passed}</span>
      </span>
      <span className="text-red-400">
        ✗ FAILED: <span className="font-bold">{failed}</span>
      </span>
      <span className="text-dr-dim">
        ○ SKIPPED: <span className="font-bold">{skipped}</span>
      </span>
      <span className="text-dr-muted">
        DURATION: <span className="font-bold">{formatDuration(durationMs)}</span>
      </span>
      {coveragePercent != null && (
        <span className={coveragePercent >= 80 ? 'text-dr-green' : 'text-dr-amber'}>
          COV: <span className="font-bold">{coveragePercent}%</span>
        </span>
      )}
    </div>
  );
}
