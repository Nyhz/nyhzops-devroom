"use client"

import { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface LogEntry {
  timestamp: number;
  type: 'log' | 'status' | 'error';
  content: string;
}

interface TerminalProps {
  logs: LogEntry[];
  className?: string;
}

const typeStyles = {
  log: 'text-dr-muted',
  status: 'text-dr-green',
  error: 'text-dr-red',
} as const;

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function Terminal({ logs, className }: TerminalProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <ScrollArea className={cn('max-h-96 bg-dr-bg p-3', className)}>
      <div className="space-y-0.5 font-data text-xs">
        {logs.map((entry, i) => (
          <div key={`${entry.timestamp}-${i}`} className="flex gap-3 leading-relaxed">
            <span className="text-dr-dim shrink-0 select-none">
              {formatTimestamp(entry.timestamp)}
            </span>
            <span className={typeStyles[entry.type]}>{entry.content}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
