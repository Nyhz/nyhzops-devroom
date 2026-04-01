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
              'relative shrink-0 w-9 h-5 rounded-full transition-all duration-200 cursor-pointer border',
              item.enabled
                ? 'bg-tac-green/30 border-tac-green/60 shadow-[0_0_8px_rgba(0,255,0,0.2)]'
                : 'bg-dr-bg border-dr-border',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200',
                item.enabled
                  ? 'left-[18px] bg-tac-green shadow-[0_0_6px_rgba(0,255,0,0.6)]'
                  : 'left-0.5 bg-dr-muted',
              )}
            />
          </button>
        </div>
      ))}
    </div>
  );
}
