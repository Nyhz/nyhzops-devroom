import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { Server as SocketIOServer } from 'socket.io';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { createAuthenticatedHomeAt } from '@/lib/process/claude-print';
import { generalSessions, generalMessages, battlefields } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import { config } from '@/lib/config';
import { buildGeneralPrompt } from './general-prompt';
import { parseCommand } from './general-commands';
import { getSystemAsset } from '@/lib/orchestrator/system-asset';
import { buildAssetCliArgs } from '@/lib/orchestrator/asset-cli';
import { filterFlags } from '@/lib/utils/cli';
import { StreamParser } from '@/lib/orchestrator/stream-parser';

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

  // 5. Load GENERAL asset for full config (model, effort, skills, MCPs)
  // System prompt is delivered via stdin (buildGeneralPrompt) rather than --append-system-prompt
  // because the general assistant persona differs from the DB-stored campaign planner persona.
  const generalAsset = getSystemAsset('GENERAL');
  const assetArgs = buildAssetCliArgs(generalAsset);
  // Filter --max-turns (we set our own) and --append-system-prompt (persona via stdin)
  const filteredAssetArgs = filterFlags(assetArgs, ['--max-turns', '--append-system-prompt']);

  // 6. Build CLI args
  const isFirstMessage = !session.sessionId;
  const cliArgs: string[] = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--max-turns', '50',
    ...filteredAssetArgs,
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

  // 9. Spawn Claude process with isolated HOME
  // Use a persistent HOME per session so --resume can find previous session data
  const persistentHome = createAuthenticatedHomeAt(`/tmp/claude-general-${sessionId}`);

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

  const parser = new StreamParser();

  parser.onDelta((text) => {
    fullResponse += text;
    io.to(room).emit('general:chunk', { sessionId, content: text });
  });

  parser.onResult((result) => {
    const sid = parser.getSessionId();
    if (sid) extractedSessionId = sid;
    if (!fullResponse && result.result && typeof result.result === 'string') {
      fullResponse = result.result;
      io.to(room).emit('general:chunk', { sessionId, content: result.result });
    }
  });

  proc.stdout.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) parser.feed(line);
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
        parser.feed(lineBuffer);
      }

      // Pick up session ID from parser if not already captured
      if (!extractedSessionId) {
        extractedSessionId = parser.getSessionId();
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
