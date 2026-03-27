"use client"

import { useRef, useEffect, useMemo } from 'react';
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

interface DisplayEntry {
  timestamp: number;
  type: 'log' | 'status' | 'error';
  content: string;
  count: number;
}

const typeStyles = {
  log: 'text-dr-muted',
  status: 'text-dr-green',
  error: 'text-dr-red',
} as const;

const TOOL_PATTERN = /^Tool: \w+$/;

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function groupLogs(logs: LogEntry[]): DisplayEntry[] {
  const result: DisplayEntry[] = [];

  for (const entry of logs) {
    const prev = result[result.length - 1];
    const isToolCall = TOOL_PATTERN.test(entry.content.trim());

    if (
      isToolCall &&
      prev &&
      prev.content.trim() === entry.content.trim() &&
      prev.type === entry.type
    ) {
      prev.count++;
      prev.timestamp = entry.timestamp;
    } else {
      result.push({ ...entry, count: 1 });
    }
  }

  return result;
}

export function Terminal({ logs, className }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const grouped = useMemo(() => groupLogs(logs), [logs]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [grouped.length]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-[480px] overflow-y-auto bg-dr-bg p-3 border border-dr-border',
        className,
      )}
    >
      <div className="space-y-0.5 font-data text-xs">
        {grouped.map((entry, i) => (
          <div key={`${entry.timestamp}-${i}`} className="flex gap-3 leading-relaxed">
            <span className="text-dr-dim shrink-0 select-none">
              {formatTimestamp(entry.timestamp)}
            </span>
            <span className={typeStyles[entry.type]}>
              {entry.content}
              {entry.count > 1 && (
                <span className="text-dr-dim ml-1.5">({entry.count})</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
