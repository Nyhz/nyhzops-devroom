import { describe, it, expect } from 'vitest';
import { detectCycle } from '../dependency-graph';

describe('detectCycle', () => {
  it('returns null for an acyclic graph', () => {
    const nodes = [
      { title: 'A', dependsOn: [] },
      { title: 'B', dependsOn: ['A'] },
      { title: 'C', dependsOn: ['B'] },
    ];
    expect(detectCycle(nodes)).toBeNull();
  });

  it('detects a simple cycle (A ↔ B)', () => {
    const nodes = [
      { title: 'A', dependsOn: ['B'] },
      { title: 'B', dependsOn: ['A'] },
    ];
    const result = detectCycle(nodes);
    expect(result).not.toBeNull();
    expect(result).toMatch(/Circular dependency/);
    expect(result).toContain('A');
    expect(result).toContain('B');
  });

  it('detects a transitive cycle (A → B → C → A)', () => {
    const nodes = [
      { title: 'A', dependsOn: ['B'] },
      { title: 'B', dependsOn: ['C'] },
      { title: 'C', dependsOn: ['A'] },
    ];
    const result = detectCycle(nodes);
    expect(result).not.toBeNull();
    expect(result).toMatch(/Circular dependency/);
    expect(result).toContain('->');
  });

  it('returns null for an empty graph', () => {
    expect(detectCycle([])).toBeNull();
  });

  it('returns null when no node has dependencies', () => {
    const nodes = [
      { title: 'X', dependsOn: [] },
      { title: 'Y', dependsOn: [] },
      { title: 'Z', dependsOn: [] },
    ];
    expect(detectCycle(nodes)).toBeNull();
  });

  it('returns null for a diamond-shaped DAG (no cycle)', () => {
    // A → B, A → C, B → D, C → D
    const nodes = [
      { title: 'A', dependsOn: [] },
      { title: 'B', dependsOn: ['A'] },
      { title: 'C', dependsOn: ['A'] },
      { title: 'D', dependsOn: ['B', 'C'] },
    ];
    expect(detectCycle(nodes)).toBeNull();
  });

  it('ignores dependencies referencing unknown nodes', () => {
    // 'Ghost' is not in the node list — should not cause a false cycle
    const nodes = [
      { title: 'A', dependsOn: ['Ghost'] },
      { title: 'B', dependsOn: ['A'] },
    ];
    expect(detectCycle(nodes)).toBeNull();
  });

  it('returns a path string ending with the repeated node', () => {
    const nodes = [
      { title: 'Alpha', dependsOn: ['Beta'] },
      { title: 'Beta', dependsOn: ['Alpha'] },
    ];
    const result = detectCycle(nodes);
    expect(result).not.toBeNull();
    // Path must close the loop: last token equals first token after "Circular dependency: "
    const path = result!.replace('Circular dependency: ', '').split(' -> ');
    expect(path[0]).toBe(path[path.length - 1]);
  });
});
