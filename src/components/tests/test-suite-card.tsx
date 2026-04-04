'use client';

import { useState } from 'react';
import { TacCard } from '@/components/ui/tac-card';
import { TestFailureDetail } from './test-failure-detail';
import { cn } from '@/lib/utils';
import type { TestSuiteResult } from '@/types';

interface TestSuiteCardProps {
  suite: TestSuiteResult;
  className?: string;
}

export function TestSuiteCard({ suite, className }: TestSuiteCardProps) {
  const passed = suite.tests.filter((t) => t.status === 'passed').length;
  const failed = suite.tests.filter((t) => t.status === 'failed').length;
  const skipped = suite.tests.filter((t) => t.status === 'skipped').length;
  const hasFailed = failed > 0;

  const [expanded, setExpanded] = useState(hasFailed);

  return (
    <TacCard status={hasFailed ? 'red' : 'green'} className={cn('p-0', className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-dr-border/10 transition-colors"
      >
        <span className="text-dr-dim text-xs">{expanded ? '▼' : '▶'}</span>
        <span className="text-dr-text text-sm font-mono truncate flex-1">
          {suite.file}
        </span>
        <div className="flex gap-2 shrink-0">
          {passed > 0 && (
            <span className="text-green-400 text-xs font-mono">✓ {passed}</span>
          )}
          {failed > 0 && (
            <span className="text-red-400 text-xs font-mono">✗ {failed}</span>
          )}
          {skipped > 0 && (
            <span className="text-dr-dim text-xs font-mono">○ {skipped}</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-dr-border px-4 py-2 space-y-1">
          {suite.tests.map((test, i) => (
            <div key={`${test.name}-${i}`}>
              <div className="flex items-center gap-2 py-1">
                <span
                  className={cn(
                    'text-xs',
                    test.status === 'passed' && 'text-green-400',
                    test.status === 'failed' && 'text-red-400',
                    test.status === 'skipped' && 'text-dr-dim',
                  )}
                >
                  {test.status === 'passed' ? '✓' : test.status === 'failed' ? '✗' : '○'}
                </span>
                <span className="text-dr-text text-sm font-mono flex-1 truncate">
                  {test.name}
                </span>
                <span className="text-dr-dim text-xs font-mono shrink-0">
                  {test.durationMs}ms
                </span>
              </div>
              {test.status === 'failed' && test.error && (
                <TestFailureDetail error={test.error} className="ml-4 mb-2" />
              )}
            </div>
          ))}
        </div>
      )}
    </TacCard>
  );
}
