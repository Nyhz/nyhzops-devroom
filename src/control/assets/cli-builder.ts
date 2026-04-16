export function buildClaudeArgs(opts: {
  asset: { codename: string; model: string; maxTurns: number; effort: string; isSystem: number; systemPrompt: string; skills: string[]; mcpServers: unknown[] };
  rulesOfEngagement: string;
  outputFormat: 'stream-json' | 'print';
  extraFlags: string[];
}): string[] {
  const args: string[] = [];
  args.push('--print');
  args.push('--dangerously-skip-permissions');
  args.push('--model', opts.asset.model);
  args.push('--max-turns', String(opts.asset.maxTurns));
  args.push('--effort', opts.asset.effort);
  args.push('--output-format', opts.outputFormat);
  if (opts.outputFormat === 'stream-json') {
    args.push('--verbose');
  }

  const sys = opts.asset.isSystem
    ? opts.asset.systemPrompt
    : `${opts.rulesOfEngagement}\n\n${opts.asset.systemPrompt}`;
  args.push('--append-system-prompt', sys);

  for (const skill of opts.asset.skills) {
    const pluginDir = resolveSkillPluginDir(skill);
    if (pluginDir) args.push('--plugin-dir', pluginDir);
  }
  if (opts.asset.mcpServers.length > 0) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: opts.asset.mcpServers }));
  }
  args.push(...opts.extraFlags);
  return args;
}

function resolveSkillPluginDir(skill: string): string | null {
  // skill format: "skillname@publisher"
  const match = skill.match(/^(.+)@(.+)$/);
  if (!match) return null;
  return `${process.env.HOME}/.claude/plugins/cache/${match[2]}/${match[1]}`;
}
