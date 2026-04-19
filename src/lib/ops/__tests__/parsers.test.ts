import { describe, it, expect } from 'vitest';
import { parseLaunchctlPrint, parsePsOutput } from '../parsers';

describe('parseLaunchctlPrint', () => {
  it('extracts pid and last exit code from launchctl print output', () => {
    const out = `
com.devroom.app = {
  pid = 12345
  last exit code = 0
  ...
}`;
    expect(parseLaunchctlPrint(out)).toEqual({ pid: 12345, lastExitCode: 0 });
  });

  it('returns pid=null when service is not running', () => {
    const out = `Could not find service "com.devroom.app" in domain for ...`;
    expect(parseLaunchctlPrint(out)).toEqual({ pid: null, lastExitCode: null });
  });

  it('parses last exit = (never exited) as null', () => {
    const out = `pid = 99\nlast exit code = (never exited)\n`;
    expect(parseLaunchctlPrint(out)).toEqual({ pid: 99, lastExitCode: null });
  });
});

describe('parsePsOutput', () => {
  it('parses rss KB and cpu percent', () => {
    expect(parsePsOutput('  145920  1.2')).toEqual({ rssBytes: 145920 * 1024, cpuPercent: 1.2 });
  });

  it('returns null-ish on empty output', () => {
    expect(parsePsOutput('')).toBeNull();
  });
});
