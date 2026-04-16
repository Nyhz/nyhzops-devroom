/**
 * Dependency graph utilities for campaign missions.
 *
 * Pure module — no DB, no I/O. Operates on plain `MissionNode` records
 * (for validation) or `{ id, dependsOn, status }` slices (for cascade).
 *
 * Status literal convention: this module matches the DB-level lowercase
 * values used by `MissionStatus` in `src/types/status.ts` (e.g. `'standby'`,
 * `'in_combat'`). The spec (§3, §8.3) renders statuses in uppercase for
 * display purposes, but the runtime comparison here is lowercase to stay
 * aligned with schema/Drizzle values.
 */

export interface MissionNode {
  id: string;
  title?: string;
  dependsOn: string[];
}

/**
 * DFS cycle detection. Returns the cycle path (array of node IDs, last
 * repeated as the closing edge) if a cycle is found, else `null`.
 *
 * Self-dependencies (A -> A) are reported as ['A', 'A'].
 */
export function detectCycle(nodes: MissionNode[]): string[] | null {
  const byId = new Map<string, MissionNode>();
  for (const n of nodes) byId.set(n.id, n);

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  const stack: string[] = [];

  function visit(id: string): string[] | null {
    color.set(id, GRAY);
    stack.push(id);
    const node = byId.get(id);
    if (node) {
      for (const depId of node.dependsOn) {
        if (!byId.has(depId)) {
          // Missing refs are handled by validatePlan; skip here.
          continue;
        }
        const c = color.get(depId) ?? WHITE;
        if (c === GRAY) {
          // Found a back-edge — slice out the cycle path.
          const startIdx = stack.indexOf(depId);
          return [...stack.slice(startIdx), depId];
        }
        if (c === WHITE) {
          const found = visit(depId);
          if (found) return found;
        }
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const n of nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE) {
      const found = visit(n.id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Validates a plan:
 *  - all `dependsOn` references resolve to a node in the list
 *  - no self-dependencies
 *  - no cycles
 */
export function validatePlan(nodes: MissionNode[]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(nodes.map((n) => n.id));

  // Detect duplicate IDs — not in the spec but cheap and informative.
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) {
      errors.push(`duplicate mission id: ${n.id}`);
    }
    seen.add(n.id);
  }

  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      if (dep === n.id) {
        errors.push(`self-dependency: ${n.id}`);
        continue;
      }
      if (!ids.has(dep)) {
        errors.push(`missing dependency: ${n.id} -> ${dep}`);
      }
    }
  }

  const cycle = detectCycle(nodes);
  if (cycle) {
    errors.push(`cycle detected: ${cycle.join(' -> ')}`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Finds all STANDBY missions reachable via reverse `dependsOn` edges from
 * `originId` (i.e. missions that depend on the origin, transitively).
 *
 * Per spec §8.3: only missions currently in `standby` cascade. Running,
 * queued, merging, or terminal missions are past the dependency gate and
 * are left alone.
 *
 * The origin itself is not included in the result.
 */
export function findTransitiveDependents(
  originId: string,
  missions: Array<{ id: string; dependsOn: string[]; status: string }>,
): string[] {
  // Build reverse adjacency: dep -> [missions that depend on dep]
  const reverse = new Map<string, string[]>();
  for (const m of missions) {
    for (const dep of m.dependsOn) {
      const arr = reverse.get(dep);
      if (arr) arr.push(m.id);
      else reverse.set(dep, [m.id]);
    }
  }

  const byId = new Map<string, { id: string; dependsOn: string[]; status: string }>();
  for (const m of missions) byId.set(m.id, m);

  const cascaded: string[] = [];
  const seen = new Set<string>([originId]);
  const queue: string[] = [originId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = reverse.get(current) ?? [];
    for (const depId of dependents) {
      if (seen.has(depId)) continue;
      seen.add(depId);
      const dep = byId.get(depId);
      if (!dep) continue;
      if (dep.status !== 'standby') {
        // Past the dependency gate — stop cascading through this branch.
        continue;
      }
      cascaded.push(depId);
      queue.push(depId);
    }
  }

  return cascaded;
}
