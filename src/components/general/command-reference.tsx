'use client';

import { getAllCommands } from '@/lib/general/general-commands';

interface CommandReferenceProps {
  open: boolean;
  onClose: () => void;
}

export function CommandReference({ open, onClose }: CommandReferenceProps) {
  if (!open) return null;

  const commands = getAllCommands();

  return (
    <div className="absolute right-0 top-0 h-full w-72 bg-dr-surface border-l border-dr-border z-40 overflow-y-auto">
      <div className="p-4 space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
            COMMANDS
          </span>
          <button
            onClick={onClose}
            className="text-dr-dim hover:text-dr-text text-sm font-mono"
          >
            ✕
          </button>
        </div>

        {/* Context */}
        <div className="space-y-2">
          <div className="text-dr-muted font-tactical text-[10px] tracking-widest uppercase">
            CONTEXT
          </div>
          {commands.native
            .filter((c) => ['/clear', '/compact'].includes(c.name))
            .map((cmd) => (
              <CommandRow key={cmd.name} name={cmd.name} description={cmd.description} />
            ))}
        </div>

        {/* Info */}
        <div className="space-y-2">
          <div className="text-dr-muted font-tactical text-[10px] tracking-widest uppercase">
            INFO
          </div>
          {commands.native
            .filter((c) => !['/clear', '/compact'].includes(c.name))
            .map((cmd) => (
              <CommandRow key={cmd.name} name={cmd.name} description={cmd.description} />
            ))}
        </div>

        {/* DEVROOM Shortcuts */}
        <div className="space-y-2">
          <div className="text-dr-muted font-tactical text-[10px] tracking-widest uppercase">
            DEVROOM SHORTCUTS
          </div>
          {commands.custom.map((cmd) => (
            <CommandRow key={cmd.name} name={cmd.name} description={cmd.description} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CommandRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-dr-green font-mono text-xs">{name}</div>
      <div className="text-dr-dim font-mono text-[11px]">{description}</div>
    </div>
  );
}
