'use client';

import { cn } from '@/lib/utils';

interface ToggleItem {
  id: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
}

interface SkillToggleListProps {
  items: ToggleItem[];
  onToggle: (id: string, enabled: boolean) => void;
  emptyMessage?: string;
}

export function SkillToggleList({ items, onToggle, emptyMessage }: SkillToggleListProps) {
  if (items.length === 0) {
    return (
      <div className="text-dr-dim font-mono text-xs py-4">
        {emptyMessage ?? 'No items discovered.'}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between gap-4 py-2 px-3 border border-dr-border bg-dr-surface"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-dr-text truncate">{item.name}</span>
              <span className="text-xs px-1.5 py-0.5 bg-dr-bg text-dr-muted border border-dr-border rounded font-mono shrink-0">
                {item.source}
              </span>
            </div>
            {item.description ? (
              <div className="text-dr-muted font-mono text-xs mt-0.5 truncate">
                {item.description}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={item.enabled}
            onClick={() => onToggle(item.id, !item.enabled)}
            className={cn(
              'relative shrink-0 w-10 h-5 rounded-full transition-colors',
              'min-w-[44px] min-h-[44px] md:min-w-[40px] md:min-h-[20px]',
              'flex items-center',
              item.enabled
                ? 'bg-tac-green/40 border border-tac-green shadow-[0_0_6px_rgba(0,255,0,0.3)]'
                : 'bg-dr-bg border border-dr-border',
            )}
          >
            <span
              className={cn(
                'block w-3.5 h-3.5 rounded-full transition-transform',
                item.enabled
                  ? 'translate-x-5 bg-tac-green shadow-[0_0_4px_rgba(0,255,0,0.5)]'
                  : 'translate-x-1 bg-dr-muted',
              )}
            />
          </button>
        </div>
      ))}
    </div>
  );
}
