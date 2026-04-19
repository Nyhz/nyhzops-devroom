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
      <div className="flex justify-between p-1 text-xs font-mono">
        <span className="text-amber-500">COMMS :: {slug.toUpperCase()}</span>
        <div className="flex gap-3">
          <label>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />{' '}
            auto
          </label>
          <button onClick={() => setLines([])}>CLEAR</button>
        </div>
      </div>
      <div ref={ref} className="h-80 overflow-auto p-2 text-xs font-mono text-green-400 whitespace-pre">
        {lines.length ? lines.join('\n') : 'NO COMMS'}
      </div>
    </div>
  );
}
