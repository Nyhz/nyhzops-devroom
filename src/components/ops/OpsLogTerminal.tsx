'use client';
import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@/hooks/use-socket';

export function OpsLogTerminal({ slug }: { slug: string }) {
  const socket = useSocket();
  const [lines, setLines] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!socket) return;
    setLines([]);
    socket.emit('ops:logs:subscribe', slug);
    const onLog = (p: { slug: string; line: string }) => {
      if (p.slug !== slug) return;
      setLines((prev) => [...prev.slice(-999), p.line]);
    };
    socket.on('ops:logs', onLog);
    return () => {
      socket.off('ops:logs', onLog);
      socket.emit('ops:logs:unsubscribe', slug);
    };
  }, [socket, slug]);

  useEffect(() => {
    if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, autoScroll]);

  return (
    <div className="border border-zinc-800 bg-black">
      <div className="flex justify-between items-center px-2 py-1.5 border-b border-zinc-800 text-xs font-mono bg-zinc-950/60">
        <span className="text-amber-500 tracking-[0.3em]">:: {slug.toUpperCase()}</span>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            role="switch"
            aria-checked={autoScroll}
            onClick={() => setAutoScroll((v) => !v)}
            title="Follow the tail as new log lines arrive"
            className={[
              'flex items-center gap-2 px-2 py-1 border tracking-[0.25em] uppercase text-[10px] transition-colors',
              autoScroll
                ? 'border-amber-500/60 text-amber-400 bg-amber-500/5'
                : 'border-zinc-700 text-zinc-500 hover:border-zinc-500',
            ].join(' ')}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoScroll ? 'bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.8)]' : 'bg-zinc-700'}`} />
            AUTOSCROLL
          </button>
          <button
            type="button"
            onClick={() => setLines([])}
            title="Clear the log buffer"
            className="px-2 py-1 border border-zinc-700 text-zinc-400 tracking-[0.25em] uppercase text-[10px] hover:border-red-500/60 hover:text-red-400 hover:bg-red-500/5 transition-colors"
          >
            CLEAR
          </button>
        </div>
      </div>
      <div ref={ref} className="h-80 overflow-auto p-2 text-xs font-mono text-green-400 whitespace-pre">
        {lines.length ? lines.join('\n') : 'NO COMMS'}
      </div>
    </div>
  );
}
