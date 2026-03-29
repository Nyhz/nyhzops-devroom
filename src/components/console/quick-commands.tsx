'use client';

import { useState, useTransition } from 'react';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import { TacCard } from '@/components/ui/tac-card';
import { runQuickCommand } from '@/actions/console';

interface QuickCommandsProps {
  battlefieldId: string;
  scripts: Record<string, string>;
}

export function QuickCommands({ battlefieldId, scripts }: QuickCommandsProps) {
  const [customCommand, setCustomCommand] = useState('');
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRunScript(scriptName: string) {
    const command = `npm run ${scriptName}`;
    setActiveCommand(command);
    startTransition(async () => {
      await runQuickCommand(battlefieldId, command);
      setActiveCommand(null);
    });
  }

  function handleRunCustom() {
    if (!customCommand.trim()) return;
    const cmd = customCommand.trim();
    setActiveCommand(cmd);
    startTransition(async () => {
      await runQuickCommand(battlefieldId, cmd);
      setActiveCommand(null);
    });
    setCustomCommand('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRunCustom();
    }
  }

  const scriptEntries = Object.keys(scripts);

  return (
    <TacCard>
      <div className="space-y-3">
        {/* Script buttons */}
        {scriptEntries.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {scriptEntries.map(name => {
              const command = `npm run ${name}`;
              const isActive = activeCommand === command;
              return (
                <TacButton
                  key={name}
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRunScript(name)}
                  disabled={isPending}
                  className={`min-h-[44px] ${isActive ? 'border-dr-amber text-dr-amber' : ''}`}
                >
                  {isActive ? '● ' : ''}npm run {name}
                </TacButton>
              );
            })}
          </div>
        )}

        {/* Custom command input */}
        <div className="flex gap-2">
          <TacInput
            value={customCommand}
            onChange={e => setCustomCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter custom command..."
            disabled={isPending}
            className="min-w-0 flex-1"
          />
          <TacButton
            size="sm"
            variant="primary"
            onClick={handleRunCustom}
            disabled={isPending || !customCommand.trim()}
            className="shrink-0 min-h-[44px] min-w-[44px]"
          >
            RUN
          </TacButton>
        </div>

        {/* Active command indicator */}
        {activeCommand && (
          <div className="text-xs font-data text-dr-amber">
            ● EXECUTING: {activeCommand}
          </div>
        )}
      </div>
    </TacCard>
  );
}
