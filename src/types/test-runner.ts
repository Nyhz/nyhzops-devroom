// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------
export type TestFramework = 'vitest' | 'jest' | 'playwright' | 'mocha';

export type TestRunStatus = 'running' | 'passed' | 'failed' | 'error';

export interface TestRun {
  id: string;
  battlefieldId: string;
  framework: TestFramework;
  command: string;
  pattern?: string;
  status: TestRunStatus;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  coveragePercent?: number;
  results?: TestSuiteResult[];
  createdAt: number;
}

export interface TestSuiteResult {
  name: string;
  file: string;
  tests: TestCaseResult[];
}

export interface TestCaseResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error?: {
    message: string;
    expected?: string;
    actual?: string;
    stack?: string;
  };
}
