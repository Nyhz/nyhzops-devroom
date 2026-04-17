"use client"

import { useRef, useEffect, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { getStatusColor } from '@/components/ui/tac-badge';

const statusColorClass: Record<ReturnType<typeof getStatusColor>, string> = {
  green: 'text-dr-green',
  amber: 'text-dr-amber',
  red: 'text-dr-red',
  blue: 'text-dr-blue',
  teal: 'text-dr-teal',
  dim: 'text-dr-dim',
};

const STATUS_LINE_PATTERNS: RegExp[] = [
  /^Status\s*(?:→|->)\s*([A-Z_ ]+)\s*$/i,
  /^Mission\s+(queued|accomplished|compromised|abandoned)\b/i,
];

/** When a CONTROL comms entry is a status-transition line, return the
 *  tac-badge color class for that status. Keeps status beats visually aligned
 *  with the mission status badge. */
function statusLineColor(actor: LogActor | undefined, content: string): string | null {
  if (actor !== 'CONTROL') return null;
  const trimmed = content.trim();
  for (const pat of STATUS_LINE_PATTERNS) {
    const m = trimmed.match(pat);
    if (m) return statusColorClass[getStatusColor(m[1])];
  }
  return null;
}

export type LogActor = 'CONTROL' | 'OPERATIVE' | 'OVERSEER' | 'COMMANDER';

interface LogEntry {
  timestamp: number;
  type: 'comms' | 'sitrep' | 'alert';
  content: string;
  actor?: LogActor;
}

interface TerminalProps {
  logs: LogEntry[];
  className?: string;
}

interface DisplayEntry {
  timestamp: number;
  type: 'comms' | 'sitrep' | 'alert';
  content: string;
  actor?: LogActor;
  count: number;
}

const typeStyles = {
  comms: 'text-dr-text',
  sitrep: 'text-dr-green',
  alert: 'text-dr-red',
} as const;

/** Tailwind color classes for actor labels. */
const actorStyles: Record<LogActor, string> = {
  CONTROL: 'text-dr-dim',
  OPERATIVE: 'text-dr-green',
  OVERSEER: 'text-dr-teal',
  COMMANDER: 'text-dr-amber',
};

/** When set, the actor's info-level content is colored with this class
 *  (overriding the default `type` color). Keeps CONTROL milestone beats
 *  visually distinct from OPERATIVE prose. */
const actorContentStyles: Partial<Record<LogActor, string>> = {
  CONTROL: 'text-dr-green',
};

const TOOL_PATTERN = /^Tool: \w+/;

/** Match a trailing `(+N -M)` diff suffix on an Edit tool_use line. */
const EDIT_DIFF_SUFFIX = /^(.*?)\s(\(\+(\d+)\s-(\d+)\))\s*$/;

function renderContent(content: string): ReactNode {
  const m = content.match(EDIT_DIFF_SUFFIX);
  if (!m) return content;
  const [, head, , added, removed] = m;
  return (
    <>
      {head}{' '}
      <span className="text-dr-dim">(</span>
      <span className="text-dr-green">+{added}</span>
      <span className="text-dr-dim"> </span>
      <span className="text-dr-red">-{removed}</span>
      <span className="text-dr-dim">)</span>
    </>
  );
}

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
      prev.type === entry.type &&
      prev.actor === entry.actor
    ) {
      // Collapse repeated identical tool calls — tight retry loops become "(N)"
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
        'h-[300px] md:h-[480px] overflow-y-auto bg-dr-bg p-3 border border-dr-border',
        className,
      )}
    >
      <div className="space-y-0.5 font-data text-xs">
        {grouped.map((entry, i) => {
          const statusColor =
            entry.type === 'comms' ? statusLineColor(entry.actor, entry.content) : null;
          const contentClass =
            statusColor ??
            (entry.actor && entry.type === 'comms' && actorContentStyles[entry.actor]
              ? actorContentStyles[entry.actor]
              : typeStyles[entry.type]);
          const labelClass = entry.actor ? actorStyles[entry.actor] : '';
          return (
          <div key={`${entry.timestamp}-${i}`} className="flex gap-3 leading-relaxed">
            <span className="text-dr-dim shrink-0 select-none">
              {formatTimestamp(entry.timestamp)}
            </span>
            <span className={cn(contentClass, 'whitespace-pre-wrap break-all')}>
              {entry.actor && (
                <span
                  className={cn(labelClass, 'mr-1 select-none font-tactical')}
                  data-actor={entry.actor}
                >
                  [{entry.actor}]
                </span>
              )}
              {renderContent(entry.content)}
              {entry.count > 1 && (
                <span className="text-dr-dim ml-1.5">({entry.count})</span>
              )}
            </span>
          </div>
          );
        })}
      </div>
    </div>
  );
}
