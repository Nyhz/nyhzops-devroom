import { spawn } from 'child_process';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { commandLogs } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import type { RunCommandOptions, RunCommandResult } from '@/types';

export async function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  const { command, cwd, socketRoom, battlefieldId, abortSignal } = options;
  const startTime = Date.now();
  let stdout = '';
  let stderr = '';
  const io = globalThis.io;

  // Create command log record if battlefieldId provided
  const logId = battlefieldId ? generateId() : null;
  if (logId && battlefieldId) {
    const db = getDatabase();
    db.insert(commandLogs).values({
      id: logId,
      battlefieldId,
      command,
      output: '',
      createdAt: startTime,
    }).run();
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      cwd,
      shell: true,
      signal: abortSignal,
    });

    const handleData = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      const text = data.toString();
      if (stream === 'stdout') stdout += text;
      else stderr += text;

      // Stream via Socket.IO
      if (socketRoom && io) {
        io.to(socketRoom).emit('console:output', {
          battlefieldId,
          content: text,
          timestamp: Date.now(),
        });
      }

      // Append to command log in DB
      if (logId && battlefieldId) {
        const db = getDatabase();
        const current = db.select({ output: commandLogs.output })
          .from(commandLogs)
          .where(eq(commandLogs.id, logId))
          .get();
        if (current) {
          db.update(commandLogs)
            .set({ output: (current.output || '') + text })
            .where(eq(commandLogs.id, logId))
            .run();
        }
      }
    };

    proc.stdout?.on('data', handleData('stdout'));
    proc.stderr?.on('data', handleData('stderr'));

    proc.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      const exitCode = code ?? 1;

      // Update command log with final status
      if (logId && battlefieldId) {
        const db = getDatabase();
        db.update(commandLogs)
          .set({ exitCode, durationMs })
          .where(eq(commandLogs.id, logId))
          .run();
      }

      // Emit exit event
      if (socketRoom && io) {
        io.to(socketRoom).emit('console:exit', {
          battlefieldId,
          exitCode,
          durationMs,
        });
      }

      resolve({ exitCode, stdout, stderr, durationMs });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}
