import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const TEST_BF_ID = 'bf_console_001';
const TEST_REPO_PATH = '/tmp/console-repo';

// Mock getDatabase — chainable query builder
const mockGet = vi.fn().mockReturnValue({
  id: TEST_BF_ID,
  repoPath: TEST_REPO_PATH,
  codename: 'CONSOLE-TEST',
  devServerCommand: 'npm run dev',
});
const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

// For getCommandHistory — needs orderBy and limit
const mockHistoryAll = vi.fn().mockReturnValue([]);
const mockHistoryLimit = vi.fn().mockReturnValue({ all: mockHistoryAll });
const mockHistoryOrderBy = vi.fn().mockReturnValue({ limit: mockHistoryLimit });
const mockHistoryWhere = vi.fn().mockReturnValue({ orderBy: mockHistoryOrderBy });
const mockHistoryFrom = vi.fn().mockReturnValue({ where: mockHistoryWhere });
const mockHistorySelect = vi.fn().mockReturnValue({ from: mockHistoryFrom });

// Toggle between regular select and history select based on the table
let selectMode: 'battlefield' | 'history' = 'battlefield';
const dynamicSelect = vi.fn((...args: unknown[]) => {
  if (selectMode === 'history') return mockHistorySelect(...args);
  return mockSelect(...args);
});

vi.mock('@/lib/db/index', () => ({
  getDatabase: vi.fn(() => ({
    select: dynamicSelect,
  })),
}));

// Mock runCommand
const mockRunCommand = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', durationMs: 100 });
vi.mock('@/lib/process/command-runner', () => ({
  runCommand: (...args: unknown[]) => mockRunCommand(...args),
}));

// Mock fs
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  default: { readFileSync: (...args: unknown[]) => mockReadFileSync(...args) },
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

// Mock DevServerManager on globalThis
const mockDevServerManager = {
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  getStatus: vi.fn().mockReturnValue({ running: false, port: null, pid: null, uptime: null }),
};
globalThis.devServerManager = mockDevServerManager as unknown as typeof globalThis.devServerManager;

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  startDevServer,
  stopDevServer,
  restartDevServer,
  getDevServerStatus,
  runQuickCommand,
  getPackageScripts,
  getCommandHistory,
} from '../console';

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  selectMode = 'battlefield';
  mockGet.mockReturnValue({
    id: TEST_BF_ID,
    repoPath: TEST_REPO_PATH,
    codename: 'CONSOLE-TEST',
    devServerCommand: 'npm run dev',
  });
  globalThis.devServerManager = mockDevServerManager as unknown as typeof globalThis.devServerManager;
});

// ---------------------------------------------------------------------------
// startDevServer
// ---------------------------------------------------------------------------

describe('startDevServer', () => {
  it('starts the dev server via DevServerManager', async () => {
    await startDevServer(TEST_BF_ID);

    expect(mockDevServerManager.start).toHaveBeenCalledWith(
      TEST_BF_ID,
      'npm run dev',
      TEST_REPO_PATH,
    );
  });

  it('throws when battlefield not found', async () => {
    mockGet.mockReturnValue(undefined);
    await expect(startDevServer('nonexistent')).rejects.toThrow('not found');
  });

  it('throws when no dev server command configured', async () => {
    mockGet.mockReturnValue({
      id: TEST_BF_ID,
      repoPath: TEST_REPO_PATH,
      codename: 'NO-CMD',
      devServerCommand: null,
    });
    await expect(startDevServer(TEST_BF_ID)).rejects.toThrow('no dev server command');
  });

  it('throws when DevServerManager not initialized', async () => {
    globalThis.devServerManager = undefined as unknown as typeof globalThis.devServerManager;
    await expect(startDevServer(TEST_BF_ID)).rejects.toThrow('not initialized');
  });
});

// ---------------------------------------------------------------------------
// stopDevServer
// ---------------------------------------------------------------------------

describe('stopDevServer', () => {
  it('stops the dev server via DevServerManager', async () => {
    await stopDevServer(TEST_BF_ID);
    expect(mockDevServerManager.stop).toHaveBeenCalledWith(TEST_BF_ID);
  });

  it('throws when DevServerManager not initialized', async () => {
    globalThis.devServerManager = undefined as unknown as typeof globalThis.devServerManager;
    await expect(stopDevServer(TEST_BF_ID)).rejects.toThrow('not initialized');
  });
});

// ---------------------------------------------------------------------------
// restartDevServer
// ---------------------------------------------------------------------------

describe('restartDevServer', () => {
  it('restarts the dev server via DevServerManager', async () => {
    await restartDevServer(TEST_BF_ID);

    expect(mockDevServerManager.restart).toHaveBeenCalledWith(
      TEST_BF_ID,
      'npm run dev',
      TEST_REPO_PATH,
    );
  });

  it('throws when battlefield not found', async () => {
    mockGet.mockReturnValue(undefined);
    await expect(restartDevServer('nonexistent')).rejects.toThrow('not found');
  });

  it('throws when no dev server command configured', async () => {
    mockGet.mockReturnValue({
      id: TEST_BF_ID,
      repoPath: TEST_REPO_PATH,
      codename: 'NO-CMD',
      devServerCommand: null,
    });
    await expect(restartDevServer(TEST_BF_ID)).rejects.toThrow('no dev server command');
  });
});

// ---------------------------------------------------------------------------
// getDevServerStatus
// ---------------------------------------------------------------------------

describe('getDevServerStatus', () => {
  it('returns status from DevServerManager', async () => {
    mockDevServerManager.getStatus.mockReturnValue({
      running: true,
      port: 3000,
      pid: 12345,
      uptime: 60000,
    });

    const status = await getDevServerStatus(TEST_BF_ID);

    expect(status).toEqual({
      running: true,
      port: 3000,
      pid: 12345,
      uptime: 60000,
    });
    expect(mockDevServerManager.getStatus).toHaveBeenCalledWith(TEST_BF_ID);
  });

  it('returns stopped status when manager not initialized', async () => {
    globalThis.devServerManager = undefined as unknown as typeof globalThis.devServerManager;

    const status = await getDevServerStatus(TEST_BF_ID);

    expect(status).toEqual({
      running: false,
      port: null,
      pid: null,
      uptime: null,
    });
  });
});

// ---------------------------------------------------------------------------
// runQuickCommand
// ---------------------------------------------------------------------------

describe('runQuickCommand', () => {
  it('fires runCommand with correct options', async () => {
    await runQuickCommand(TEST_BF_ID, 'echo hello');

    expect(mockRunCommand).toHaveBeenCalledWith({
      command: 'echo hello',
      cwd: TEST_REPO_PATH,
      socketRoom: `console:${TEST_BF_ID}`,
      battlefieldId: TEST_BF_ID,
    });
  });

  it('throws when battlefield not found', async () => {
    mockGet.mockReturnValue(undefined);
    await expect(runQuickCommand('nonexistent', 'echo')).rejects.toThrow('not found');
  });

  it('does not throw when runCommand rejects (fire and forget)', async () => {
    // runCommand is called but its rejection is caught internally
    mockRunCommand.mockRejectedValue(new Error('command failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Should not throw — fire and forget
    await runQuickCommand(TEST_BF_ID, 'failing-cmd');

    // Allow microtask to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getPackageScripts
// ---------------------------------------------------------------------------

describe('getPackageScripts', () => {
  it('reads and parses package.json scripts', async () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        name: 'test-pkg',
        scripts: {
          dev: 'next dev',
          build: 'next build',
          test: 'vitest',
        },
      }),
    );

    const scripts = await getPackageScripts(TEST_BF_ID);

    expect(scripts).toEqual({
      dev: 'next dev',
      build: 'next build',
      test: 'vitest',
    });
  });

  it('returns empty object when package.json has no scripts', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'no-scripts' }));

    const scripts = await getPackageScripts(TEST_BF_ID);
    expect(scripts).toEqual({});
  });

  it('returns empty object when package.json not found', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const scripts = await getPackageScripts(TEST_BF_ID);
    expect(scripts).toEqual({});
  });

  it('throws when battlefield not found', async () => {
    mockGet.mockReturnValue(undefined);
    await expect(getPackageScripts('nonexistent')).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// getCommandHistory
// ---------------------------------------------------------------------------

describe('getCommandHistory', () => {
  it('returns command logs ordered by createdAt desc', async () => {
    const mockLogs = [
      { id: 'cl_1', command: 'echo 1', createdAt: 2000 },
      { id: 'cl_2', command: 'echo 2', createdAt: 1000 },
    ];
    mockHistoryAll.mockReturnValue(mockLogs);
    selectMode = 'history';

    const history = await getCommandHistory(TEST_BF_ID);

    expect(history).toEqual(mockLogs);
  });

  it('respects custom limit parameter', async () => {
    mockHistoryAll.mockReturnValue([]);
    selectMode = 'history';

    await getCommandHistory(TEST_BF_ID, 5);

    expect(mockHistoryLimit).toHaveBeenCalledWith(5);
  });

  it('uses default limit of 20', async () => {
    mockHistoryAll.mockReturnValue([]);
    selectMode = 'history';

    await getCommandHistory(TEST_BF_ID);

    expect(mockHistoryLimit).toHaveBeenCalledWith(20);
  });
});
