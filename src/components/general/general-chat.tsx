'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useGeneral } from '@/hooks/use-general';
import { createGeneralSession, closeGeneralSession, renameGeneralSession, getSessionMessages } from '@/actions/general';
import { TacButton } from '@/components/ui/tac-button';
import { TacTextareaWithImages } from '@/components/ui/tac-textarea-with-images';
import { NewSessionModal } from './new-session-modal';
import { CloseSessionModal } from './close-session-modal';
import { CommandReference } from './command-reference';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface Session {
  id: string;
  name: string;
  sessionId: string | null;
  battlefieldId: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

interface Message {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

interface Battlefield {
  id: string;
  codename: string;
}

interface GeneralChatProps {
  initialSessions: Session[];
  initialMessages: Message[];
  initialActiveSessionId: string | null;
  battlefields: Battlefield[];
}

export function GeneralChat({
  initialSessions,
  initialMessages,
  initialActiveSessionId,
  battlefields,
}: GeneralChatProps) {
  const searchParams = useSearchParams();

  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialActiveSessionId);
  const [sessionMessages, setSessionMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [closeTarget, setCloseTarget] = useState<Session | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const { messages, streaming, isLoading, error, sendMessage } = useGeneral(
    activeSessionId,
    sessionMessages,
  );

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Auto-create session if opened from battlefield with ?battlefield=<id>
  useEffect(() => {
    const bfId = searchParams.get('battlefield');
    if (bfId && sessions.length === 0) {
      const bf = battlefields.find((b) => b.id === bfId);
      handleCreateSession(bf?.codename ? `${bf.codename} Session` : 'New Session', bfId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateSession = async (name: string, battlefieldId?: string) => {
    const session = await createGeneralSession(name, battlefieldId);
    setSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);
    setSessionMessages([]);
    setShowNewModal(false);
  };

  const handleCloseSession = async () => {
    if (!closeTarget) return;
    await closeGeneralSession(closeTarget.id);
    setSessions((prev) => prev.filter((s) => s.id !== closeTarget.id));
    if (activeSessionId === closeTarget.id) {
      const remaining = sessions.filter((s) => s.id !== closeTarget.id);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
      if (remaining.length > 0) {
        const msgs = await getSessionMessages(remaining[0].id);
        setSessionMessages(msgs);
      } else {
        setSessionMessages([]);
      }
    }
    setCloseTarget(null);
  };

  const handleSwitchSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    const msgs = await getSessionMessages(sessionId);
    setSessionMessages(msgs);
  };

  const handleRename = async () => {
    if (!activeSession || !editName.trim()) return;
    await renameGeneralSession(activeSession.id, editName.trim());
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? { ...s, name: editName.trim() } : s)),
    );
    setEditingName(false);
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !activeSessionId) return;
    sendMessage(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Empty state — no sessions
  if (sessions.length === 0 && !showNewModal) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="text-center space-y-3">
          <div className="text-dr-amber font-tactical text-3xl tracking-[0.3em]">GENERAL</div>
          <div className="text-dr-muted font-mono text-sm">
            Your strategic advisor and DEVROOM administrator
          </div>
        </div>
        <TacButton variant="success" onClick={() => setShowNewModal(true)}>
          NEW SESSION
        </TacButton>
        <NewSessionModal
          open={showNewModal}
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreateSession}
          battlefields={battlefields}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Tab bar */}
      <div className="flex items-center border-b border-dr-border bg-dr-surface shrink-0">
        <div className="flex-1 flex items-center overflow-x-auto">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => handleSwitchSession(session.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 font-tactical text-xs tracking-wider border-b-2 transition-colors shrink-0',
                session.id === activeSessionId
                  ? 'border-dr-green text-dr-green bg-dr-elevated'
                  : 'border-transparent text-dr-muted hover:text-dr-text hover:bg-dr-elevated',
              )}
            >
              <span className="truncate max-w-[160px]">{session.name}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setCloseTarget(session);
                }}
                className="text-dr-dim hover:text-dr-red ml-1 text-[10px]"
              >
                ✕
              </span>
            </button>
          ))}
          <button
            onClick={() => setShowNewModal(true)}
            className="px-4 py-2.5 text-dr-dim hover:text-dr-amber font-mono text-sm transition-colors shrink-0"
          >
            +
          </button>
        </div>
        <button
          onClick={() => setShowCommands((v) => !v)}
          className={cn(
            'px-4 py-2.5 font-mono text-sm transition-colors shrink-0',
            showCommands ? 'text-dr-amber' : 'text-dr-dim hover:text-dr-amber',
          )}
        >
          ?
        </button>
      </div>

      {/* Chat header */}
      {activeSession && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-dr-border bg-dr-surface shrink-0">
          <div className="flex items-center gap-3">
            {editingName ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                className="bg-dr-bg border border-dr-amber text-dr-text font-tactical text-sm px-2 py-1 focus:outline-none"
                autoFocus
              />
            ) : (
              <button
                onClick={() => {
                  setEditName(activeSession.name);
                  setEditingName(true);
                }}
                className="text-dr-text font-tactical text-sm hover:text-dr-amber transition-colors"
              >
                {activeSession.name}
              </button>
            )}
            {activeSession.battlefieldId && (
              <span className="text-dr-dim font-mono text-[10px]">
                BATTLEFIELD LINKED
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <TacButton
              variant="ghost"
              size="sm"
              onClick={() => sendMessage('/clear')}
              disabled={isLoading}
            >
              CLEAR CONTEXT
            </TacButton>
            <TacButton
              variant="ghost"
              size="sm"
              onClick={() => sendMessage('/compact')}
              disabled={isLoading}
            >
              COMPACT
            </TacButton>
            <TacButton
              variant="danger"
              size="sm"
              onClick={() => setCloseTarget(activeSession)}
            >
              END SESSION
            </TacButton>
          </div>
        </div>
      )}

      {/* Chat body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 relative">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
        ))}

        {/* Streaming response */}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[80%] space-y-1">
              <div className="text-dr-amber font-tactical text-[10px] tracking-widest">GENERAL</div>
              <div className="text-dr-text font-mono text-sm leading-relaxed prose prose-invert prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>
                <span className="inline-block w-2 h-4 bg-dr-amber animate-pulse ml-0.5" />
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !streaming && (
          <div className="flex justify-start">
            <div className="text-dr-dim font-mono text-sm animate-pulse">
              GENERAL is thinking...
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-dr-red/10 border border-dr-red/30 text-dr-red font-mono text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />

        {/* Command reference overlay */}
        <CommandReference open={showCommands} onClose={() => setShowCommands(false)} />
      </div>

      {/* Input */}
      {activeSession && (
        <div className="border-t border-dr-border bg-dr-surface p-3 shrink-0">
          <div className="flex gap-3">
            <TacTextareaWithImages
              value={input}
              onChange={setInput}
              onKeyDown={handleKeyDown}
              placeholder="Talk to GENERAL..."
              rows={2}
              disabled={isLoading}
              className="flex-1"
            />
            <TacButton
              variant="success"
              size="sm"
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="self-end"
            >
              SEND
            </TacButton>
          </div>
        </div>
      )}

      {/* Modals */}
      <NewSessionModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreate={handleCreateSession}
        battlefields={battlefields}
      />
      <CloseSessionModal
        open={!!closeTarget}
        sessionName={closeTarget?.name ?? ''}
        onClose={() => setCloseTarget(null)}
        onConfirm={handleCloseSession}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({ role, content }: { role: string; content: string }) {
  if (role === 'system') {
    return (
      <div className="flex justify-center py-2">
        <span className="text-dr-dim font-mono text-[11px] tracking-widest">{content}</span>
      </div>
    );
  }

  const isCommander = role === 'commander';

  return (
    <div className={cn('flex', isCommander ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[80%] space-y-1')}>
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
              : 'text-dr-text prose prose-invert prose-sm max-w-none',
          )}
        >
          {isCommander ? (
            content
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
