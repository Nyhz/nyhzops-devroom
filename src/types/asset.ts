// ---------------------------------------------------------------------------
// Asset skills & MCP types
// ---------------------------------------------------------------------------
export interface SkillOverrides {
  added?: string[];
  removed?: string[];
}

export interface DiscoveredSkill {
  id: string;
  name: string;
  pluginName: string;
  description: string;
  pluginDir: string;
}

export interface DiscoveredMcp {
  id: string;
  name: string;
  command: string;
  args: string[];
  source: string;
}
