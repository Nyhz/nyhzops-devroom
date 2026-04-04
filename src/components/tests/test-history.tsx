'use client';

import { useState, useTransition } from 'react';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { TestSummary } from './test-summary';
import { TestResults } from './test-results';
import { getTestRun } from '@/actions/tests';
import type { TestRunRow, TestSuiteResult } from '@/types';

interface TestHistoryProps {
  battlefieldId: string;
  initialHistory: TestRunRow[];
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    passed: 'text-dr-green',
    failed: 'text-dr-red',
    running: 'text-dr-amber',
    error: 'text-dr-dim',
  };

  return (
    <span className={`font-mono text-xs uppercase ${styles[status] ?? 'text-dr-dim'}`}>
      {status}
    </span>
  );
}

export function TestHistory({ initialHistory }: TestHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedResults, setExpandedResults] = useState<TestSuiteResult[] | null>(null);
  const [expandedRun, setExpandedRun] = useState<TestRunRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleRowClick = (run: TestRunRow) => {
    if (expandedId === run.id) {
      setExpandedId(null);
      setExpandedResults(null);
      setExpandedRun(null);
      return;
    }

    setExpandedId(run.id);
    setExpandedResults(null);
    setExpandedRun(null);

    startTransition(async () => {
      const full = await getTestRun(run.id);
      if (full) {
        setExpandedRun(full);
        if (full.results) {
          try {
            setExpandedResults(JSON.parse(full.results) as TestSuiteResult[]);
          } catch {
            setExpandedResults([]);
          }
        } else {
          setExpandedResults([]);
        }
      }
    });
  };

  const columns = [
    {
      key: 'date',
      header: 'Date',
      render: (run: TestRunRow) => (
        <span className="text-dr-text text-xs">{formatDate(run.createdAt)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (run: TestRunRow) => <StatusBadge status={run.status} />,
    },
    {
      key: 'total',
      header: 'Total',
      render: (run: TestRunRow) => <span className="text-dr-text text-xs">{run.totalTests}</span>,
      hideOnMobile: true,
    },
    {
      key: 'passed',
      header: 'Passed',
      render: (run: TestRunRow) => <span className="text-green-400 text-xs">{run.passed}</span>,
    },
    {
      key: 'failed',
      header: 'Failed',
      render: (run: TestRunRow) => (
        <span className={`text-xs ${run.failed > 0 ? 'text-red-400' : 'text-dr-dim'}`}>
          {run.failed}
        </span>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (run: TestRunRow) => (
        <span className="text-dr-muted text-xs">{formatDuration(run.durationMs)}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'coverage',
      header: 'Coverage',
      render: (run: TestRunRow) => (
        <span
          className={`text-xs ${
            run.coveragePercent != null
              ? run.coveragePercent >= 80
                ? 'text-dr-green'
                : 'text-dr-amber'
              : 'text-dr-dim'
          }`}
        >
          {run.coveragePercent != null ? `${run.coveragePercent}%` : '—'}
        </span>
      ),
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-0">
      <ResponsiveTable
        columns={columns}
        data={initialHistory}
        keyExtractor={(run) => run.id}
        onRowClick={handleRowClick}
        emptyMessage="No test runs recorded."
      />

      {expandedId && (
        <div className="border border-dr-border border-t-0 bg-dr-surface/50 p-4 space-y-4">
          {isPending && (
            <div className="text-dr-dim text-xs font-mono animate-pulse">
              Loading run details...
            </div>
          )}
          {expandedRun && !isPending && (
            <>
              <TestSummary
                total={expandedRun.totalTests}
                passed={expandedRun.passed}
                failed={expandedRun.failed}
                skipped={expandedRun.skipped}
                durationMs={expandedRun.durationMs}
                coveragePercent={expandedRun.coveragePercent ?? undefined}
              />
              {expandedResults && expandedResults.length > 0 && (
                <TestResults suites={expandedResults} />
              )}
              {expandedResults && expandedResults.length === 0 && (
                <div className="text-dr-dim text-xs font-mono">
                  No structured results available for this run.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
