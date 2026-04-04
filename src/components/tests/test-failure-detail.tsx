'use client';

import { cn } from '@/lib/utils';

interface TestFailureDetailProps {
  error: {
    message: string;
    expected?: string;
    actual?: string;
    stack?: string;
  };
  className?: string;
}

export function TestFailureDetail({ error, className }: TestFailureDetailProps) {
  return (
    <div className={cn('border-l-2 border-red-500 pl-4 space-y-3', className)}>
      <p className="text-red-400 text-sm font-mono">{error.message}</p>

      {error.expected != null && error.actual != null && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-tactical tracking-wider text-dr-dim mb-1">
              EXPECTED
            </div>
            <pre className="font-mono text-sm text-green-400/80 bg-dr-bg/50 p-2 overflow-x-auto">
              {error.expected}
            </pre>
          </div>
          <div>
            <div className="text-[10px] font-tactical tracking-wider text-dr-dim mb-1">
              ACTUAL
            </div>
            <pre className="font-mono text-sm text-red-400/80 bg-dr-bg/50 p-2 overflow-x-auto">
              {error.actual}
            </pre>
          </div>
        </div>
      )}

      {error.stack && (
        <details>
          <summary className="text-dr-dim text-xs font-mono cursor-pointer hover:text-dr-muted">
            STACK TRACE
          </summary>
          <pre className="font-mono text-xs text-dr-dim mt-2 max-h-48 overflow-y-auto bg-dr-bg/50 p-2">
            {error.stack}
          </pre>
        </details>
      )}
    </div>
  );
}
