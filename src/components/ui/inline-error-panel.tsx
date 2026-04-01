'use client';

import { cn } from '@/lib/utils';

interface ErrorAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface InlineErrorPanelProps {
  title: string;
  detail: string;
  context?: string;
  actions: ErrorAction[];
  className?: string;
}

const actionVariantClasses: Record<NonNullable<ErrorAction['variant']>, string> = {
  primary:
    'bg-tac-green/20 text-tac-green border-tac-green/30 hover:bg-tac-green/30',
  secondary:
    'bg-tac-muted/20 text-tac-muted border-tac-muted/30 hover:bg-tac-muted/30',
  danger:
    'bg-tac-red/20 text-tac-red border-tac-red/30 hover:bg-tac-red/30',
};

export function InlineErrorPanel({
  title,
  detail,
  context,
  actions,
  className,
}: InlineErrorPanelProps) {
  return (
    <div
      className={cn(
        'border border-tac-red/30 bg-tac-red/5 rounded px-3 py-2',
        className,
      )}
    >
      <p className="text-tac-red font-mono text-xs font-bold uppercase tracking-wider">
        {title}
      </p>
      <p className="text-tac-dim text-xs font-mono mt-1">{detail}</p>
      {context !== undefined && (
        <p
          className="text-tac-muted text-xs font-mono italic mt-1"
          data-testid="inline-error-context"
        >
          {context}
        </p>
      )}
      {actions.length > 0 && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              className={cn(
                'px-2 py-1 text-xs font-mono border rounded transition-colors',
                actionVariantClasses[action.variant ?? 'secondary'],
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
