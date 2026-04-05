import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

const { mockRunClaudePrint, mockGetAssetMemory, mockUpdateAssetMemory } = vi.hoisted(() => ({
  mockRunClaudePrint: vi.fn(),
  mockGetAssetMemory: vi.fn(),
  mockUpdateAssetMemory: vi.fn(),
}));

vi.mock('@/lib/process/claude-print', () => ({
  runClaudePrint: mockRunClaudePrint,
}));

vi.mock('@/actions/asset', () => ({
  getAssetMemory: mockGetAssetMemory,
  updateAssetMemory: mockUpdateAssetMemory,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { runSelfReflection } from '../self-reflection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIo() {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  return { to, emit };
}

function makeParams(overrides: Partial<Parameters<typeof runSelfReflection>[0]> = {}) {
  return {
    assetId: 'asset-001',
    assetCodename: 'ALPHA',
    debrief: 'Mission complete. Used consistent naming conventions throughout.',
    currentMemory: [],
    missionId: 'mission-001',
    io: makeIo() as ReturnType<typeof makeIo> & { to: ReturnType<typeof vi.fn> },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runSelfReflection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAssetMemory.mockResolvedValue({ entries: [] });
  });

  // -------------------------------------------------------------------------
  // Valid JSON response — add/remove/replace operations
  // -------------------------------------------------------------------------

  it('applies add operations from a valid LLM response', async () => {
    const newEntries = ['Always write tests before refactoring.', 'Prefer small commits.'];
    mockRunClaudePrint.mockResolvedValue(JSON.stringify({ add: newEntries }));
    mockUpdateAssetMemory.mockResolvedValue({ entries: newEntries });

    const result = await runSelfReflection(makeParams());

    expect(mockUpdateAssetMemory).toHaveBeenCalledWith('asset-001', {
      add: newEntries,
      remove: undefined,
      replace: undefined,
    });
    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.replaced).toBe(0);
  });

  it('applies remove operations from a valid LLM response', async () => {
    const currentMemory = ['Entry A', 'Entry B', 'Entry C'];
    mockRunClaudePrint.mockResolvedValue(JSON.stringify({ remove: [1] }));
    mockUpdateAssetMemory.mockResolvedValue({ entries: ['Entry A', 'Entry C'] });

    const result = await runSelfReflection(makeParams({ currentMemory }));

    expect(mockUpdateAssetMemory).toHaveBeenCalledWith('asset-001', {
      add: undefined,
      remove: [1],
      replace: undefined,
    });
    expect(result.removed).toBe(1);
    expect(result.added).toBe(0);
    expect(result.replaced).toBe(0);
  });

  it('applies replace operations from a valid LLM response', async () => {
    const currentMemory = ['Old lesson here.', 'Entry B'];
    mockRunClaudePrint.mockResolvedValue(JSON.stringify({ replace: { '0': 'New updated lesson.' } }));
    mockUpdateAssetMemory.mockResolvedValue({ entries: ['New updated lesson.', 'Entry B'] });

    const result = await runSelfReflection(makeParams({ currentMemory }));

    expect(mockUpdateAssetMemory).toHaveBeenCalledWith('asset-001', {
      add: undefined,
      remove: undefined,
      replace: [{ index: 0, value: 'New updated lesson.' }],
    });
    expect(result.replaced).toBe(1);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
  });

  it('applies combined add + remove + replace in a single call', async () => {
    const currentMemory = ['Keep A', 'Remove me', 'Replace me'];
    const llmResponse = {
      add: ['Brand new lesson.'],
      remove: [1],
      replace: { '2': 'Replaced lesson.' },
    };
    mockRunClaudePrint.mockResolvedValue(JSON.stringify(llmResponse));
    mockUpdateAssetMemory.mockResolvedValue({ entries: ['Keep A', 'Replaced lesson.', 'Brand new lesson.'] });

    const result = await runSelfReflection(makeParams({ currentMemory }));

    expect(mockUpdateAssetMemory).toHaveBeenCalledWith('asset-001', {
      add: ['Brand new lesson.'],
      remove: [1],
      replace: [{ index: 2, value: 'Replaced lesson.' }],
    });
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.replaced).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Empty response — no changes
  // -------------------------------------------------------------------------

  it('returns zero changes for an empty {} response', async () => {
    mockRunClaudePrint.mockResolvedValue('{}');

    const result = await runSelfReflection(makeParams());

    expect(mockUpdateAssetMemory).not.toHaveBeenCalled();
    expect(result).toEqual({ added: 0, removed: 0, replaced: 0 });
  });

  it('returns zero changes when add is an empty array', async () => {
    mockRunClaudePrint.mockResolvedValue(JSON.stringify({ add: [] }));

    const result = await runSelfReflection(makeParams());

    expect(mockUpdateAssetMemory).not.toHaveBeenCalled();
    expect(result).toEqual({ added: 0, removed: 0, replaced: 0 });
  });

  // -------------------------------------------------------------------------
  // Malformed / unparseable responses
  // -------------------------------------------------------------------------

  it('handles non-JSON response gracefully — no crash, zero changes', async () => {
    mockRunClaudePrint.mockResolvedValue('This is not JSON at all.');

    const result = await runSelfReflection(makeParams());

    expect(mockUpdateAssetMemory).not.toHaveBeenCalled();
    expect(result).toEqual({ added: 0, removed: 0, replaced: 0 });
  });

  it('handles JSON array response gracefully — no crash', async () => {
    mockRunClaudePrint.mockResolvedValue('["not", "an", "object"]');

    const result = await runSelfReflection(makeParams());

    expect(mockUpdateAssetMemory).not.toHaveBeenCalled();
    expect(result).toEqual({ added: 0, removed: 0, replaced: 0 });
  });

  it('handles response wrapped in markdown fences', async () => {
    mockRunClaudePrint.mockResolvedValue('```json\n{"add":["Fenced lesson."]}\n```');
    mockUpdateAssetMemory.mockResolvedValue({ entries: ['Fenced lesson.'] });

    const result = await runSelfReflection(makeParams());

    expect(mockUpdateAssetMemory).toHaveBeenCalled();
    expect(result.added).toBe(1);
  });

  it('handles empty string response gracefully — no crash', async () => {
    mockRunClaudePrint.mockResolvedValue('');

    const result = await runSelfReflection(makeParams());

    expect(mockUpdateAssetMemory).not.toHaveBeenCalled();
    expect(result).toEqual({ added: 0, removed: 0, replaced: 0 });
  });

  // -------------------------------------------------------------------------
  // Out-of-bounds remove indices are filtered out
  // -------------------------------------------------------------------------

  it('ignores remove indices that are out-of-bounds', async () => {
    const currentMemory = ['Only entry'];
    // Index 5 is out of bounds — should be filtered before calling updateAssetMemory
    mockRunClaudePrint.mockResolvedValue(JSON.stringify({ remove: [5, 99] }));

    const result = await runSelfReflection(makeParams({ currentMemory }));

    // All indices filtered → treated as empty → no update call
    expect(mockUpdateAssetMemory).not.toHaveBeenCalled();
    expect(result).toEqual({ added: 0, removed: 0, replaced: 0 });
  });

  it('keeps valid remove indices and drops out-of-bounds ones', async () => {
    const currentMemory = ['Entry 0', 'Entry 1', 'Entry 2'];
    // Index 1 is valid; index 99 is out-of-bounds
    mockRunClaudePrint.mockResolvedValue(JSON.stringify({ remove: [1, 99] }));
    mockUpdateAssetMemory.mockResolvedValue({ entries: ['Entry 0', 'Entry 2'] });

    const result = await runSelfReflection(makeParams({ currentMemory }));

    expect(mockUpdateAssetMemory).toHaveBeenCalledWith('asset-001', {
      add: undefined,
      remove: [1],
      replace: undefined,
    });
    expect(result.removed).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Socket emissions
  // -------------------------------------------------------------------------

  it('emits to the mission room and hq:activity room', async () => {
    mockRunClaudePrint.mockResolvedValue('{}');
    const io = makeIo();

    await runSelfReflection(makeParams({ io: io as Parameters<typeof runSelfReflection>[0]['io'] }));

    // Should have emitted to mission room
    expect(io.to).toHaveBeenCalledWith('mission:mission-001');
    // Should have emitted to hq:activity room
    expect(io.to).toHaveBeenCalledWith('hq:activity');
  });
});
