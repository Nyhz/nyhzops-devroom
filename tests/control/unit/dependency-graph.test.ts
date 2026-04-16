import { describe, it, expect } from 'vitest';
import {
  detectCycle,
  validatePlan,
  findTransitiveDependents,
  type MissionNode,
} from '@/control/campaign/dependency-graph';

describe('validatePlan', () => {
  it('accepts a valid DAG with no errors', () => {
    const nodes: MissionNode[] = [
      { id: 'A', dependsOn: [] },
      { id: 'B', dependsOn: ['A'] },
      { id: 'C', dependsOn: ['A', 'B'] },
    ];
    const result = validatePlan(nodes);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects missing dependency references', () => {
    const nodes: MissionNode[] = [
      { id: 'A', dependsOn: [] },
      { id: 'B', dependsOn: ['GHOST'] },
    ];
    const result = validatePlan(nodes);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('missing dependency'))).toBe(true);
    expect(result.errors.some((e) => e.includes('B -> GHOST'))).toBe(true);
  });

  it('rejects self-dependency', () => {
    const nodes: MissionNode[] = [{ id: 'A', dependsOn: ['A'] }];
    const result = validatePlan(nodes);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('self-dependency'))).toBe(true);
  });

  it('rejects a simple cycle', () => {
    const nodes: MissionNode[] = [
      { id: 'A', dependsOn: ['B'] },
      { id: 'B', dependsOn: ['A'] },
    ];
    const result = validatePlan(nodes);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  it('rejects a longer cycle (A -> B -> C -> A)', () => {
    const nodes: MissionNode[] = [
      { id: 'A', dependsOn: ['B'] },
      { id: 'B', dependsOn: ['C'] },
      { id: 'C', dependsOn: ['A'] },
    ];
    const result = validatePlan(nodes);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('cycle'))).toBe(true);
  });
});

describe('detectCycle', () => {
  it('returns null for acyclic graphs', () => {
    const nodes: MissionNode[] = [
      { id: 'A', dependsOn: [] },
      { id: 'B', dependsOn: ['A'] },
    ];
    expect(detectCycle(nodes)).toBeNull();
  });

  it('returns the cycle path for a 3-cycle', () => {
    const nodes: MissionNode[] = [
      { id: 'A', dependsOn: ['B'] },
      { id: 'B', dependsOn: ['C'] },
      { id: 'C', dependsOn: ['A'] },
    ];
    const cycle = detectCycle(nodes);
    expect(cycle).not.toBeNull();
    // Path is closed (first and last id match).
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    expect(cycle!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('findTransitiveDependents', () => {
  it('cascades through a 3-deep chain of STANDBY missions', () => {
    // A (origin) -> B -> C -> D, all standby. Abandoning A should cascade all.
    const missions = [
      { id: 'A', dependsOn: [], status: 'standby' },
      { id: 'B', dependsOn: ['A'], status: 'standby' },
      { id: 'C', dependsOn: ['B'], status: 'standby' },
      { id: 'D', dependsOn: ['C'], status: 'standby' },
    ];
    const cascaded = findTransitiveDependents('A', missions);
    expect(cascaded.sort()).toEqual(['B', 'C', 'D']);
  });

  it('does not include the origin itself', () => {
    const missions = [
      { id: 'A', dependsOn: [], status: 'standby' },
      { id: 'B', dependsOn: ['A'], status: 'standby' },
    ];
    const cascaded = findTransitiveDependents('A', missions);
    expect(cascaded).not.toContain('A');
  });

  it('partial cascade: stops at non-standby missions and past their descendants', () => {
    // A -> B (standby) -> C (in_combat) -> D (standby)
    // Also A -> E (standby)
    // Abandoning A should cascade B and E, but NOT C (running) and NOT D
    // (past the gate — its parent C is already running).
    const missions = [
      { id: 'A', dependsOn: [], status: 'standby' },
      { id: 'B', dependsOn: ['A'], status: 'standby' },
      { id: 'C', dependsOn: ['B'], status: 'in_combat' },
      { id: 'D', dependsOn: ['C'], status: 'standby' },
      { id: 'E', dependsOn: ['A'], status: 'standby' },
    ];
    const cascaded = findTransitiveDependents('A', missions).sort();
    expect(cascaded).toEqual(['B', 'E']);
  });

  it('returns empty list when no mission depends on origin', () => {
    const missions = [
      { id: 'A', dependsOn: [], status: 'standby' },
      { id: 'B', dependsOn: [], status: 'standby' },
    ];
    expect(findTransitiveDependents('A', missions)).toEqual([]);
  });

  it('does not cascade through already-terminal missions', () => {
    // A -> B (abandoned) -> C (standby). Re-abandoning A should leave C alone.
    const missions = [
      { id: 'A', dependsOn: [], status: 'standby' },
      { id: 'B', dependsOn: ['A'], status: 'abandoned' },
      { id: 'C', dependsOn: ['B'], status: 'standby' },
    ];
    expect(findTransitiveDependents('A', missions)).toEqual([]);
  });
});
