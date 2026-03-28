interface CustomCommand {
  name: string;
  description: string;
  usage: string;
  expand: (args: string) => string;
}

const CUSTOM_COMMANDS: CustomCommand[] = [
  {
    name: 'sitrep',
    description: 'Full situation report on all operations',
    usage: '/sitrep',
    expand: () =>
      'Give me a full situation report. Query the DEVROOM database at /data/devroom.db. Report: all active missions and their status, any stuck or failed missions in the last hour, active campaigns and their phase progress, asset deployment status, and any Captain escalations. Be concise — use tables where appropriate.',
  },
  {
    name: 'diagnose',
    description: 'Deep-dive a specific mission',
    usage: '/diagnose <missionId>',
    expand: (args: string) =>
      `Investigate mission ${args.trim()}. Query the DEVROOM database at /data/devroom.db. Read the mission record, its comms/logs from the missionLogs table (type column has 'log', 'status', 'error'), any Captain log entries from captainLogs, and the debrief if available. Tell me: what was the objective, what happened, where it went wrong (if it did), and what you recommend.`,
  },
];

const NATIVE_COMMANDS = ['clear', 'compact', 'cost', 'status', 'model', 'memory'];

export interface ParsedCommand {
  type: 'native' | 'custom' | 'message';
  original: string;
  expanded: string;
  commandName?: string;
  /** For native commands like /clear that need client-side visual feedback */
  systemMessage?: string;
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return { type: 'message', original: trimmed, expanded: trimmed };
  }

  const spaceIndex = trimmed.indexOf(' ');
  const commandName = (spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex)).toLowerCase();
  const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1);

  // Check custom commands first
  const custom = CUSTOM_COMMANDS.find((c) => c.name === commandName);
  if (custom) {
    return {
      type: 'custom',
      original: trimmed,
      expanded: custom.expand(args),
      commandName,
    };
  }

  // Check native commands
  if (NATIVE_COMMANDS.includes(commandName)) {
    let systemMessage: string | undefined;
    if (commandName === 'clear') systemMessage = '── CONTEXT CLEARED ──';
    if (commandName === 'compact') systemMessage = '── CONTEXT COMPACTED ──';

    return {
      type: 'native',
      original: trimmed,
      expanded: trimmed, // pass through as-is
      commandName,
      systemMessage,
    };
  }

  // Unknown slash — treat as a regular message
  return { type: 'message', original: trimmed, expanded: trimmed };
}

/** Returns all commands for the reference card UI */
export function getAllCommands() {
  return {
    native: [
      { name: '/clear', description: 'Reset conversation context' },
      { name: '/compact', description: 'Compress context to free tokens' },
      { name: '/cost', description: 'Token usage for this session' },
      { name: '/status', description: 'Model, tokens, context remaining' },
      { name: '/model <name>', description: 'Switch model mid-session' },
      { name: '/memory', description: "GENERAL's persistent memory" },
    ],
    custom: CUSTOM_COMMANDS.map((c) => ({ name: `/${c.usage.replace(/^\//, '')}`, description: c.description })),
  };
}
