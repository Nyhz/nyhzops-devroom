import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import { eq } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { createAuthenticatedHome } from '@/lib/process/claude-print';
import { generalSessions, generalMessages, assets, battlefields } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildGeneralPrompt } from './general-prompt';
import { parseCommand } from './general-commands';

// ---------------------------------------------------------------------------
// Active process tracking
// ---------------------------------------------------------------------------

interface ActiveProcess {
  proc: ChildProcessWithoutNullStreams;
  abort: AbortController;
}

const activeProcesses = new Map<string, ActiveProcess>();

// ---------------------------------------------------------------------------
// sendGeneralMessage — core entry point
// ---------------------------------------------------------------------------

export async function sendGeneralMessage(
  io: SocketIOServer,
  sessionId: string,
  rawMessage: string,
): Promise<void> {
  const db = getDatabase();

  // 1. Load session
  const session = db
    .select()
    .from(generalSessions)
    .where(eq(generalSessions.id, sessionId))
    .get();

  if (!session) {
    throw new Error(`sendGeneralMessage: session ${sessionId} not found`);
  }

  if (session.status === 'closed') {
    throw new Error(`sendGeneralMessage: session ${sessionId} is closed`);
  }

  // 2. Parse command
  const parsed = parseCommand(rawMessage);
  const room = `general:${sessionId}`;
  const now = Date.now();

  // 3. Store Commander's message (show original, not expanded)
  db.insert(generalMessages)
    .values({
      id: generateId(),
      sessionId,
      role: 'commander',
      content: parsed.original,
      timestamp: now,
    })
    .run();

  // 4. If command has a system message (like /clear), store and emit it
  if (parsed.systemMessage) {
    const sysMsgId = generateId();
    db.insert(generalMessages)
      .values({
        id: sysMsgId,
        sessionId,
        role: 'system',
        content: parsed.systemMessage,
        timestamp: now + 1,
      })
      .run();
    io.to(room).emit('general:system', { sessionId, content: parsed.systemMessage, messageId: sysMsgId });
  }

  // 5. Find GENERAL asset for model
  const generalAsset = db
    .select()
    .from(assets)
    .where(eq(assets.codename, 'GENERAL'))
    .get();
  const model = generalAsset?.model || 'claude-opus-4-6';

  // 6. Build CLI args
  const isFirstMessage = !session.sessionId;
  const cliArgs: string[] = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--max-turns', '50',
    '--model', model,
  ];

  if (!isFirstMessage && session.sessionId) {
    cliArgs.push('--resume', session.sessionId);
  }

  // 7. Build stdin content
  let stdinContent: string;

  if (isFirstMessage) {
    const systemPrompt = buildGeneralPrompt(session.battlefieldId);
    stdinContent = systemPrompt + '\n\n---\n\nCommander says: ' + parsed.expanded;
  } else {
    stdinContent = parsed.expanded;
  }

  // 8. Determine working directory
  let cwd = '/tmp';
  if (session.battlefieldId) {
    const bf = db.select().from(battlefields).where(eq(battlefields.id, session.battlefieldId)).get();
    if (bf) cwd = bf.repoPath;
  }

  // 9. Spawn Claude process with host-synced credentials
  // Use a persistent HOME per session so --resume can find previous session data
  const persistentHome = `/tmp/claude-general-${sessionId}`;
  const persistentClaudeDir = `${persistentHome}/.claude`;
  fs.mkdirSync(persistentClaudeDir, { recursive: true });
  const realHome = process.env.HOME || '/home/devroom';
  try { fs.copyFileSync(`${realHome}/.claude.json`, `${persistentHome}/.claude.json`); } catch { /* fine */ }
  try { fs.copyFileSync(`${realHome}/.claude/settings.json`, `${persistentClaudeDir}/settings.json`); } catch { /* fine */ }
  try { fs.copyFileSync(config.hostCredentialsPath, `${persistentClaudeDir}/.credentials.json`); } catch { /* fine */ }

  const abortController = new AbortController();
  const proc = spawn(config.claudePath, cliArgs, {
    cwd,
    signal: abortController.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: persistentHome },
  });

  activeProcesses.set(sessionId, { proc, abort: abortController });

  let fullResponse = '';
  let extractedSessionId: string | null = null;
  let lineBuffer = '';

  // Parse stream-json output line by line
  proc.stdout.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);

        if (event.session_id && !extractedSessionId) {
          extractedSessionId = event.session_id;
        }

        if (event.type === 'stream_event' && event.event) {
          const inner = event.event;
          if (inner.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && inner.delta.text) {
            fullResponse += inner.delta.text;
            io.to(room).emit('general:chunk', { sessionId, content: inner.delta.text });
          }
        }

        if (event.type === 'result') {
          if (event.session_id) extractedSessionId = event.session_id;
          if (!fullResponse && event.result && typeof event.result === 'string') {
            fullResponse = event.result;
            io.to(room).emit('general:chunk', { sessionId, content: event.result });
          }
        }
      } catch {
        // Not valid JSON — ignore
      }
    }
  });

  let stderrOutput = '';
  proc.stderr.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  // Write message to stdin and close
  proc.stdin.write(stdinContent);
  proc.stdin.end();

  // Wait for process to complete
  return new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      activeProcesses.delete(sessionId);

      // Process remaining buffer
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer);
          if (event.session_id && !extractedSessionId) {
            extractedSessionId = event.session_id;
          }
          if (event.type === 'result') {
            if (event.session_id) extractedSessionId = event.session_id;
            if (!fullResponse && event.result && typeof event.result === 'string') {
              fullResponse = event.result;
            }
          }
        } catch { /* ignore */ }
      }

      // Persist Claude's session ID for --resume
      if (extractedSessionId) {
        db.update(generalSessions)
          .set({ sessionId: extractedSessionId, updatedAt: Date.now() })
          .where(eq(generalSessions.id, session!.id))
          .run();
      }

      if (code !== 0 && code !== null) {
        const errorMsg = `GENERAL process exited with code ${code}: ${stderrOutput.slice(0, 500)}`;
        io.to(room).emit('general:error', { sessionId, error: errorMsg });
        reject(new Error(errorMsg));
        return;
      }

      const responseText = fullResponse.trim();

      // Store GENERAL's response
      const msgId = generateId();
      db.insert(generalMessages)
        .values({
          id: msgId,
          sessionId: session!.id,
          role: 'general',
          content: responseText,
          timestamp: Date.now(),
        })
        .run();

      io.to(room).emit('general:complete', { sessionId, messageId: msgId, content: responseText });
      resolve();
    });

    proc.on('error', (err) => {
      activeProcesses.delete(sessionId);
      io.to(room).emit('general:error', { sessionId, error: err.message });
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// killSession — abort an active GENERAL process
// ---------------------------------------------------------------------------

export function killSession(sessionId: string): boolean {
  const active = activeProcesses.get(sessionId);
  if (!active) return false;

  active.abort.abort();
  activeProcesses.delete(sessionId);
  return true;
}
