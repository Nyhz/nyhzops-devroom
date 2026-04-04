'use client';

import { TestSuiteCard } from './test-suite-card';
import { cn } from '@/lib/utils';
import type { TestSuiteResult } from '@/types';

interface TestResultsProps {
  suites: TestSuiteResult[];
  className?: string;
}

export function TestResults({ suites, className }: TestResultsProps) {
  if (suites.length === 0) {
    return (
      <div className="text-dr-dim text-xs font-mono py-4">
        No test results available.
      </div>
    );
  }

  const sorted = [...suites].sort((a, b) => {
    const aFailed = a.tests.some((t) => t.status === 'failed') ? 0 : 1;
    const bFailed = b.tests.some((t) => t.status === 'failed') ? 0 : 1;
    return aFailed - bFailed;
  });

  return (
    <div className={cn('space-y-2', className)}>
      {sorted.map((suite, i) => (
        <TestSuiteCard key={`${suite.file}-${i}`} suite={suite} />
      ))}
    </div>
  );
}
