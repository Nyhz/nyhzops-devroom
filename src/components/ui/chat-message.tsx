import { cn } from '@/lib/utils';
import { CommanderContent } from '@/components/ui/commander-content';
import { Markdown } from '@/components/ui/markdown';

interface ChatMessageProps {
  role: string;
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export function ChatMessage({ role, content, isStreaming, className }: ChatMessageProps) {
  if (role === 'system') {
    return (
      <div className={cn('flex justify-center py-2', className)}>
        <span className="text-dr-dim font-mono text-[11px] tracking-widest">{content}</span>
      </div>
    );
  }

  const isCommander = role === 'commander';

  return (
    <div className={cn('flex', isCommander ? 'justify-end' : 'justify-start', className)}>
      <div className="max-w-[80%] space-y-1">
        <div
          className={cn(
            'font-tactical text-[10px] tracking-widest',
            isCommander ? 'text-dr-green text-right' : 'text-dr-amber',
          )}
        >
          {isCommander ? 'COMMANDER' : 'GENERAL'}
        </div>
        <div
          className={cn(
            'font-mono text-sm leading-relaxed',
            isCommander
              ? 'text-dr-text bg-dr-elevated border border-dr-border px-3 py-2'
              : 'text-dr-text',
          )}
        >
          {isCommander ? (
            <CommanderContent content={content} />
          ) : (
            <Markdown content={content} />
          )}
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-dr-amber animate-pulse ml-0.5" />
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatThinking({ className }: { className?: string }) {
  return (
    <div className={cn('flex justify-start', className)}>
      <div className="text-dr-dim font-mono text-sm animate-pulse">
        GENERAL is thinking...
      </div>
    </div>
  );
}
