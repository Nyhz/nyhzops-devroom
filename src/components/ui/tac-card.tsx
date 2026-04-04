import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface TacCardProps {
  status?: 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'dim';
  className?: string;
  children: ReactNode;
}

const statusBorderStyles = {
  green: 'border-l-2 border-l-dr-green',
  amber: 'border-l-2 border-l-dr-amber',
  red: 'border-l-2 border-l-dr-red',
  blue: 'border-l-2 border-l-dr-blue',
  teal: 'border-l-2 border-l-dr-teal',
  dim: '',
} as const;

export function TacCard({ status, className, children }: TacCardProps) {
  return (
    <div
      className={cn(
        'bg-dr-surface border border-dr-border p-6',
        status && statusBorderStyles[status],
        className,
      )}
    >
      {children}
    </div>
  );
}
