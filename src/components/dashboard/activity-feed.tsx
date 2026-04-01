'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { TacCard } from '@/components/ui/tac-card';
import { useActivityFeed, type ActivityEvent } from '@/hooks/use-activity-feed';

interface ActivityFeedProps {
  className?: string;
}

function getTypeIndicator(type: string): { icon: string; color: string } {
  const normalized = type.toLowerCase();

  if (normalized.includes('deploying')) {
    return { icon: '\u25C8', color: 'text-dr-amber' }; // ◈
  }
  if (normalized.includes('in_combat')) {
    return { icon: '\u2694', color: 'text-dr-amber' }; // ⚔
  }
  if (normalized.includes('reviewing')) {
    return { icon: '\u25C9', color: 'text-dr-blue' }; // ◉
  }
  if (normalized.includes('approved')) {
    return { icon: '\u2713', color: 'text-dr-teal' }; // ✓
  }
  if (normalized.includes('merging')) {
    return { icon: '\u27F3', color: 'text-dr-amber' }; // ⟳
  }
  if (normalized.includes('accomplished') || normalized.includes('secured')) {
    return { icon: '\u2605', color: 'text-dr-green' }; // ★
  }
  if (normalized.includes('compromised')) {
    return { icon: '\u2716', color: 'text-dr-red' }; // ✖
  }
  if (normalized.includes('abandoned')) {
    return { icon: '\u25CB', color: 'text-dr-dim' }; // ○
  }
  return { icon: '\u25CF', color: 'text-dr-muted' }; // ●
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function ActivityEntry({ event }: { event: ActivityEvent }) {
  const { icon, color } = getTypeIndicator(event.type);

  return (
    <div className="flex items-start gap-2 py-1 px-2 text-xs font-data leading-relaxed">
      <span className="text-dr-dim shrink-0">{formatTime(event.timestamp)}</span>
      <span className={cn('shrink-0 w-4 text-center', color)}>{icon}</span>
      <span className="text-dr-amber shrink-0">{event.battlefieldCodename}</span>
      <span className="text-dr-text truncate">{event.missionTitle}</span>
      {event.detail && (
        <span className="text-dr-muted truncate">{event.detail}</span>
      )}
    </div>
  );
}

export function ActivityFeed({ className }: ActivityFeedProps) {
  const events = useActivityFeed();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="text-dr-amber font-tactical text-sm tracking-widest uppercase mb-3">
        ACTIVITY FEED
      </div>
      <TacCard className="p-0 max-h-80 overflow-y-auto">
        {events.length === 0 ? (
          <div className="p-4 text-center text-dr-dim font-tactical text-xs">
            No recent activity. Deploy a mission to begin.
          </div>
        ) : (
          <div>
            {events.map((event, i) => (
              <ActivityEntry key={`${event.timestamp}-${i}`} event={event} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </TacCard>
    </div>
  );
}
