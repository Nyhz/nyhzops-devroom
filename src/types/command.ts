// ---------------------------------------------------------------------------
// Command runner types
// ---------------------------------------------------------------------------
export interface RunCommandOptions {
  command: string;
  cwd: string;
  socketRoom?: string;
  battlefieldId?: string;
  abortSignal?: AbortSignal;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
