import { spawn, ChildProcess } from 'child_process';

interface DevServerInfo {
  proc: ChildProcess;
  port: number | null;
  pid: number;
  startedAt: number;
}

export interface DevServerStatus {
  running: boolean;
  port: number | null;
  pid: number | null;
  uptime: number | null;
}

export class DevServerManager {
  private servers: Map<string, DevServerInfo> = new Map();

  start(battlefieldId: string, command: string, cwd: string): void {
    // Stop existing if running
    if (this.servers.has(battlefieldId)) this.stop(battlefieldId);

    const proc = spawn(command, { cwd, shell: true });
    const pid = proc.pid || 0;
    const info: DevServerInfo = { proc, port: null, pid, startedAt: Date.now() };
    this.servers.set(battlefieldId, info);

    // Stream output via Socket.IO
    const io = globalThis.io;
    const room = `devserver:${battlefieldId}`;

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      io?.to(room).emit('devserver:log', { battlefieldId, content: text, timestamp: Date.now() });
      // Auto-detect port from output
      const portMatch = text.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/);
      if (portMatch && !info.port) {
        info.port = parseInt(portMatch[1]);
        io?.to(room).emit('devserver:status', { battlefieldId, status: 'running', port: info.port, pid });
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      io?.to(room).emit('devserver:log', { battlefieldId, content: text, timestamp: Date.now() });
      // Also check stderr for port (some frameworks log to stderr)
      const portMatch = text.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/);
      if (portMatch && !info.port) {
        info.port = parseInt(portMatch[1]);
        io?.to(room).emit('devserver:status', { battlefieldId, status: 'running', port: info.port, pid });
      }
    });

    proc.on('close', (code) => {
      this.servers.delete(battlefieldId);
      io?.to(room).emit('devserver:status', {
        battlefieldId,
        status: code === 0 ? 'stopped' : 'crashed',
        port: null,
        pid: null,
      });
    });

    io?.to(room).emit('devserver:status', { battlefieldId, status: 'running', port: null, pid });
  }

  stop(battlefieldId: string): void {
    const info = this.servers.get(battlefieldId);
    if (!info) return;

    info.proc.kill('SIGTERM');
    // Force kill after 5s
    setTimeout(() => {
      try { info.proc.kill('SIGKILL'); } catch { /* already dead */ }
    }, 5000);
  }

  restart(battlefieldId: string, command: string, cwd: string): void {
    this.stop(battlefieldId);
    // Small delay to let the port free up
    setTimeout(() => this.start(battlefieldId, command, cwd), 1000);
  }

  getStatus(battlefieldId: string): DevServerStatus {
    const info = this.servers.get(battlefieldId);
    if (!info) return { running: false, port: null, pid: null, uptime: null };
    return {
      running: true,
      port: info.port,
      pid: info.pid,
      uptime: Date.now() - info.startedAt,
    };
  }

  stopAll(): void {
    for (const [id] of this.servers) {
      this.stop(id);
    }
  }
}
