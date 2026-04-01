export interface DependencyNode {
  title: string;
  dependsOn: string[];
}

/**
 * Detect cycles in a dependency graph using DFS.
 * Returns a string describing the cycle (e.g. "Circular dependency: A -> B -> A")
 * or null if the graph is acyclic.
 */
export function detectCycle(nodes: DependencyNode[]): string | null {
  if (nodes.length === 0) return null;

  const titleSet = new Set(nodes.map((n) => n.title));
  const adjMap = new Map<string, string[]>();
  for (const node of nodes) {
    adjMap.set(node.title, node.dependsOn.filter((d) => titleSet.has(d)));
  }

  // Track DFS state per node
  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current path
  const BLACK = 2; // fully processed
  const color = new Map<string, number>();
  for (const title of titleSet) {
    color.set(title, WHITE);
  }

  let cyclePath: string[] | null = null;

  function dfs(node: string, path: string[]): boolean {
    color.set(node, GRAY);
    path.push(node);

    for (const neighbor of adjMap.get(node) ?? []) {
      if (color.get(neighbor) === GRAY) {
        // Found a back edge — cycle detected
        const cycleStart = path.indexOf(neighbor);
        cyclePath = [...path.slice(cycleStart), neighbor];
        return true;
      }
      if (color.get(neighbor) === WHITE) {
        if (dfs(neighbor, path)) return true;
      }
    }

    path.pop();
    color.set(node, BLACK);
    return false;
  }

  for (const title of titleSet) {
    if (color.get(title) === WHITE) {
      if (dfs(title, [])) {
        break;
      }
    }
  }

  if (!cyclePath) return null;
  return `Circular dependency: ${cyclePath.join(' -> ')}`;
}
