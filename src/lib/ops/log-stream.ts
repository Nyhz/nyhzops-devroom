import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export interface LogStreamDeps {
  emit: (slug: string, line: string) => void;
}

interface Stream {
  proc: ChildProcessWithoutNullStreams;
  refCount: number;
}

export class LogStreamManager {
  private streams = new Map<string, Stream>();

  constructor(private deps: LogStreamDeps) {}

  attach(slug: string, logPath: string): void {
    const existing = this.streams.get(slug);
    if (existing) {
      existing.refCount++;
      return;
    }
    const proc = spawn('tail', ['-n', '200', '-F', logPath]);
    proc.stdout.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line.length) this.deps.emit(slug, line);
      }
    });
    proc.on('exit', () => {
      this.streams.delete(slug);
    });
    this.streams.set(slug, { proc, refCount: 1 });
  }

  detach(slug: string): void {
    const s = this.streams.get(slug);
    if (!s) return;
    s.refCount--;
    if (s.refCount <= 0) {
      s.proc.kill('SIGTERM');
      this.streams.delete(slug);
    }
  }

  shutdown(): void {
    for (const { proc } of this.streams.values()) proc.kill('SIGTERM');
    this.streams.clear();
  }
}
