'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBriefing } from '@/hooks/use-briefing';
import { TacButton } from '@/components/ui/tac-button';
import { ChatMessage, ChatThinking } from '@/components/ui/chat-message';
import { cn } from '@/lib/utils';

interface BriefingChatProps {
  campaignId: string;
  initialMessages: { id: string; role: string; content: string; timestamp: number }[];
}

export function BriefingChat({ campaignId, initialMessages }: BriefingChatProps) {
  const router = useRouter();
  const { messages, streaming, isLoading, error, planReady, sendMessage } = useBriefing(campaignId, initialMessages);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  useEffect(() => {
    if (planReady) {
      router.refresh();
    }
  }, [planReady, router]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || isLoading) return;
    setInput('');
    sendMessage(msg);
  };

  const handleGeneratePlan = () => {
    if (isLoading) return;
    sendMessage('GENERATE PLAN');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 border border-dr-border bg-dr-bg">
      {/* Chat header */}
      <div className="flex items-center justify-between px-3 py-2 md:px-4 md:py-3 border-b border-dr-border bg-dr-surface shrink-0">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <span className="text-dr-green text-xs">●</span>
          <span className="text-dr-amber font-tactical text-xs md:text-sm tracking-wider truncate">
            GENERAL — BRIEFING SESSION
          </span>
        </div>
        <TacButton
          variant="success"
          size="sm"
          onClick={handleGeneratePlan}
          disabled={isLoading || messages.length < 2}
          className="w-full md:w-auto mt-0 shrink-0"
        >
          GENERATE PLAN
        </TacButton>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="text-dr-muted font-tactical text-sm text-center py-8">
            Begin your briefing with GENERAL. Describe your objective and GENERAL will help you plan the campaign.
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
        ))}

        {streaming && (
          <ChatMessage role="general" content={streaming} isStreaming />
        )}

        {isLoading && !streaming && <ChatThinking />}

        {error && (
          <div className="bg-dr-red/10 border border-dr-red/30 p-3 text-dr-red font-data text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-dr-border shrink-0 bg-dr-surface sticky bottom-0">
        <div className="flex items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Brief the GENERAL..."
            rows={1}
            disabled={isLoading}
            className={cn(
              'flex-1 bg-transparent text-dr-text font-mono text-sm',
              'px-3 py-3 md:px-4 placeholder:text-dr-dim resize-none',
              'focus:outline-none',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className={cn(
              'px-3 py-3 md:px-4 font-tactical text-xs tracking-widest transition-colors shrink-0 min-h-[44px] min-w-[44px]',
              input.trim() && !isLoading
                ? 'text-dr-green hover:bg-dr-green/10'
                : 'text-dr-dim cursor-not-allowed',
            )}
          >
            SEND
          </button>
        </div>
      </div>
    </div>
  );
}
