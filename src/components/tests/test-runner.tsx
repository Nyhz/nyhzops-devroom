'use client';

import { useState, useEffect, useTransition, useMemo } from 'react';
import { useTestOutput } from '@/hooks/use-test-output';
import { runTests, abortTestRun, getTestRun } from '@/actions/tests';
import { TacInput } from '@/components/ui/tac-input';
import { TacButton } from '@/components/ui/tac-button';
import { Terminal } from '@/components/ui/terminal';
import { TestSummary } from './test-summary';
import { TestResults } from './test-results';
import type { TestRunRow, TestSuiteResult } from '@/types';

interface TestRunnerProps {
  battlefieldId: string;
  framework: string;
  latestRun?: TestRunRow;
}

interface Summary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  coveragePercent?: number;
}

export function TestRunner({ battlefieldId, framework, latestRun }: TestRunnerProps) {
  const [pattern, setPattern] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [results, setResults] = useState<TestSuiteResult[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const {
    logs,
    exitCode,
    isRunning: socketRunning,
    completedRunId,
    reset: resetOutput,
  } = useTestOutput(battlefieldId);

  // Initialize from latestRun
  useEffect(() => {
    if (latestRun && latestRun.results) {
      try {
        const suites = JSON.parse(latestRun.results) as TestSuiteResult[];
        setResults(suites);
        setSummary({
          total: latestRun.totalTests,
          passed: latestRun.passed,
          failed: latestRun.failed,
          skipped: latestRun.skipped,
          durationMs: latestRun.durationMs,
          coveragePercent: latestRun.coveragePercent ?? undefined,
        });
        setOutputCollapsed(true);
      } catch {
        // Invalid JSON — ignore
      }
    }
  }, [latestRun]);

  // When tests complete, fetch structured results
  useEffect(() => {
    if (!completedRunId) return;

    startTransition(async () => {
      const run = await getTestRun(completedRunId);
      if (run) {
        let suites: TestSuiteResult[] = [];
        if (run.results) {
          try {
            suites = JSON.parse(run.results) as TestSuiteResult[];
          } catch {
            // ignore
          }
        }
        setResults(suites);
        setSummary({
          total: run.totalTests,
          passed: run.passed,
          failed: run.failed,
          skipped: run.skipped,
          durationMs: run.durationMs,
          coveragePercent: run.coveragePercent ?? undefined,
        });
        setOutputCollapsed(true);
      }
      setIsRunning(false);
      setCurrentRunId(null);
    });
  }, [completedRunId]);

  const handleRun = (opts?: { pattern?: string; failedOnly?: boolean }) => {
    setResults(null);
    setSummary(null);
    setOutputCollapsed(false);
    resetOutput();
    setIsRunning(true);

    startTransition(async () => {
      try {
        const runId = await runTests(battlefieldId, opts);
        setCurrentRunId(runId);
      } catch {
        setIsRunning(false);
      }
    });
  };

  const handleAbort = () => {
    if (currentRunId) {
      startTransition(async () => {
        await abortTestRun(currentRunId);
        setIsRunning(false);
        setCurrentRunId(null);
      });
    }
  };

  const hasFailures = summary ? summary.failed > 0 : false;

  const terminalLogs = useMemo(
    () => logs.map((l) => ({ content: l.content, timestamp: l.timestamp, type: 'log' as const })),
    [logs],
  );

  const showTerminal = logs.length > 0 || isRunning || socketRunning;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        <TacInput
          placeholder="Test file pattern (optional)"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isRunning) {
              handleRun(pattern ? { pattern } : undefined);
            }
          }}
          disabled={isRunning}
          className="flex-1"
        />
        <div className="flex gap-2 flex-wrap">
          <TacButton
            size="sm"
            onClick={() => handleRun()}
            disabled={isRunning || isPending}
          >
            RUN ALL
          </TacButton>
          {pattern && (
            <TacButton
              size="sm"
              variant="ghost"
              onClick={() => handleRun({ pattern })}
              disabled={isRunning || isPending}
            >
              RUN FILTERED
            </TacButton>
          )}
          {hasFailures && !isRunning && (
            <TacButton
              size="sm"
              variant="danger"
              onClick={() => handleRun({ failedOnly: true })}
              disabled={isPending}
            >
              RE-RUN FAILED
            </TacButton>
          )}
          {isRunning && (
            <TacButton
              size="sm"
              variant="danger"
              onClick={handleAbort}
              disabled={isPending}
            >
              ABORT
            </TacButton>
          )}
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <TestSummary
          total={summary.total}
          passed={summary.passed}
          failed={summary.failed}
          skipped={summary.skipped}
          durationMs={summary.durationMs}
          coveragePercent={summary.coveragePercent}
        />
      )}

      {/* Structured results */}
      {results && results.length > 0 && <TestResults suites={results} />}

      {/* Terminal output */}
      {showTerminal && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-mono text-xs">
            {(isRunning || socketRunning) && (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-dr-amber animate-pulse" />
                <span className="text-dr-amber">RUNNING</span>
              </>
            )}
            {!isRunning && !socketRunning && exitCode === 0 && (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-dr-green" />
                <span className="text-dr-green">COMPLETED</span>
              </>
            )}
            {!isRunning && !socketRunning && exitCode !== null && exitCode !== 0 && (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-dr-red" />
                <span className="text-dr-red">FAILED (exit {exitCode})</span>
              </>
            )}
            {!isRunning && !socketRunning && logs.length > 0 && (
              <button
                onClick={() => setOutputCollapsed((prev) => !prev)}
                className="ml-auto text-dr-dim hover:text-dr-text transition-colors"
              >
                {outputCollapsed ? '▶ SHOW OUTPUT' : '▼ HIDE OUTPUT'}
              </button>
            )}
          </div>
          {!outputCollapsed && <Terminal logs={terminalLogs} />}
        </div>
      )}
    </div>
  );
}
