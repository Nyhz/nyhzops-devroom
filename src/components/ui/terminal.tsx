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
  log: 'text-dr-text',
  status: 'text-dr-green',
  error: 'text-dr-red',
} as const;

const TOOL_PATTERN = /^Tool: \w+/;

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function groupLogs(logs: LogEntry[]): DisplayEntry[] {
  const result: DisplayEntry[] = [];

  for (const entry of logs) {
    const prev = result[result.length - 1];
    const trimmed = entry.content.trim();
    const isToolCall = TOOL_PATTERN.test(trimmed);

    if (
      isToolCall &&
      prev &&
      prev.content.trim() === trimmed &&
      prev.type === entry.type
    ) {
      // Collapse repeated identical tool calls
      prev.count++;
      prev.timestamp = entry.timestamp;
    } else if (
      !isToolCall &&
      entry.type === 'log' &&
      prev &&
      prev.type === 'log' &&
      !TOOL_PATTERN.test(prev.content.trim())
    ) {
      // Coalesce consecutive text lines into one entry
      prev.content = prev.content.trimEnd() + ' ' + trimmed;
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
        'h-[300px] md:h-[480px] overflow-y-auto bg-dr-bg p-3 border border-dr-border',
        className,
      )}
    >
      <div className="space-y-0.5 font-data text-xs">
        {grouped.map((entry, i) => (
          <div key={`${entry.timestamp}-${i}`} className="flex gap-3 leading-relaxed">
            <span className="text-dr-dim shrink-0 select-none">
              {formatTimestamp(entry.timestamp)}
            </span>
            <span className={cn(typeStyles[entry.type], 'whitespace-pre-wrap break-all')}>
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
