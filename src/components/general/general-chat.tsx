'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useGeneral } from '@/hooks/use-general';
import { createGeneralSession, closeGeneralSession, renameGeneralSession, getSessionMessages } from '@/actions/general';
import { getAllCommands } from '@/lib/general/general-commands';
import { TacButton } from '@/components/ui/tac-button';
import { NewSessionModal } from './new-session-modal';
import { CloseSessionModal } from './close-session-modal';
import { CommandReference } from './command-reference';
import { ChatMessage, ChatThinking } from '@/components/ui/chat-message';
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
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  // Build flat command list for autocomplete
  const allCommands = getAllCommands();
  const flatCommands = [
    ...allCommands.native.map((c) => ({ name: c.name, description: c.description })),
    ...allCommands.custom.map((c) => ({ name: c.name, description: c.description })),
  ];

  // Filter commands based on current input (after the `/`)
  const slashQuery = slashMenuOpen ? input.slice(1).toLowerCase() : '';
  const filteredCommands = slashMenuOpen
    ? flatCommands.filter((c) => c.name.toLowerCase().startsWith('/' + slashQuery))
    : [];

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const { messages, streaming, isLoading, error, sendMessage } = useGeneral(
    activeSessionId,
    sessionMessages,
  );

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Auto-scroll slash menu to keep selected item visible
  useEffect(() => {
    if (!slashMenuOpen || !slashMenuRef.current) return;
    const item = slashMenuRef.current.children[slashMenuIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [slashMenuIndex, slashMenuOpen]);

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
    setSlashMenuOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Open slash menu when input starts with `/` and has no spaces yet (typing a command)
    if (val.startsWith('/') && !val.includes(' ')) {
      setSlashMenuOpen(true);
      setSlashMenuIndex(0);
    } else {
      setSlashMenuOpen(false);
    }
  };

  const selectSlashCommand = (commandName: string) => {
    // If the command has args placeholder (contains space), put cursor after command + space
    const hasArgs = commandName.includes(' ');
    const base = hasArgs ? commandName.split(' ')[0] + ' ' : commandName;
    setInput(base);
    setSlashMenuOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashMenuOpen && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenuIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenuIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        selectSlashCommand(filteredCommands[slashMenuIndex].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }

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
          <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
        ))}

        {/* Streaming response */}
        {streaming && (
          <ChatMessage role="general" content={streaming} isStreaming />
        )}

        {/* Loading indicator */}
        {isLoading && !streaming && <ChatThinking />}

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
        <div className="relative border-t border-dr-border shrink-0 bg-dr-surface">
          {/* Slash command autocomplete */}
          {slashMenuOpen && filteredCommands.length > 0 && (
            <div
              ref={slashMenuRef}
              className="absolute bottom-full left-0 right-0 border border-dr-border bg-dr-elevated max-h-60 overflow-y-auto overscroll-contain"
            >
              {filteredCommands.map((cmd, i) => (
                <button
                  key={cmd.name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSlashCommand(cmd.name);
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                    i === slashMenuIndex
                      ? 'bg-dr-green/10'
                      : 'hover:bg-dr-surface',
                  )}
                >
                  <span className="text-dr-green font-mono text-xs shrink-0">{cmd.name}</span>
                  <span className="text-dr-dim font-mono text-[11px] truncate">{cmd.description}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end">
            <textarea
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setSlashMenuOpen(false), 150)}
              placeholder="Talk to GENERAL..."
              rows={1}
              disabled={isLoading}
              className={cn(
                'flex-1 bg-transparent text-dr-text font-mono text-sm',
                'px-4 py-3 placeholder:text-dr-dim resize-none',
                'focus:outline-none',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className={cn(
                'px-4 py-3 font-tactical text-xs tracking-widest transition-colors shrink-0',
                input.trim() && !isLoading
                  ? 'text-dr-green hover:bg-dr-green/10'
                  : 'text-dr-dim cursor-not-allowed',
              )}
            >
              SEND
            </button>
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

