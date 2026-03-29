'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBriefing } from '@/hooks/use-briefing';
import { TacButton } from '@/components/ui/tac-button';
import { TacTextareaWithImages } from '@/components/ui/tac-textarea-with-images';

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
      <div className="flex items-center justify-between px-4 py-3 border-b border-dr-border bg-dr-surface shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-dr-green text-xs">●</span>
          <span className="text-dr-amber font-tactical text-sm tracking-wider">
            GENERAL — BRIEFING SESSION
          </span>
        </div>
        <TacButton
          variant="success"
          size="sm"
          onClick={handleGeneratePlan}
          disabled={isLoading || messages.length < 2}
        >
          GENERATE PLAN
        </TacButton>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="text-dr-muted font-tactical text-sm text-center py-8">
            Begin your briefing with GENERAL. Describe your objective and GENERAL will help you plan the campaign.
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'commander' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${
              msg.role === 'commander'
                ? 'bg-dr-elevated border border-dr-border'
                : 'bg-dr-surface border border-dr-amber/20'
            } p-3`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`font-tactical text-xs tracking-wider ${
                  msg.role === 'commander' ? 'text-dr-green' : 'text-dr-amber'
                }`}>
                  {msg.role === 'commander' ? 'COMMANDER' : 'GENERAL'}
                </span>
              </div>
              <div className="text-dr-text font-data text-sm whitespace-pre-wrap leading-relaxed">
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-dr-surface border border-dr-amber/20 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-tactical text-xs tracking-wider text-dr-amber">
                  GENERAL
                </span>
                <span className="w-2.5 h-4 bg-dr-amber/70 animate-pulse" />
              </div>
              <div className="text-dr-text font-data text-sm whitespace-pre-wrap leading-relaxed">
                {streaming}
              </div>
            </div>
          </div>
        )}

        {isLoading && !streaming && (
          <div className="flex justify-start">
            <div className="bg-dr-surface border border-dr-amber/20 p-3">
              <span className="text-dr-amber font-tactical text-xs animate-pulse">
                GENERAL is thinking...
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-dr-red/10 border border-dr-red/30 p-3 text-dr-red font-data text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-dr-border bg-dr-surface p-3">
        <div className="flex gap-3">
          <TacTextareaWithImages
            value={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            placeholder="Brief the GENERAL..."
            rows={2}
            className="flex-1 resize-none"
            disabled={isLoading}
          />
          <TacButton
            variant="primary"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="self-end"
          >
            SEND
          </TacButton>
        </div>
      </div>
    </div>
  );
}
