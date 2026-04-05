// ---------------------------------------------------------------------------
// Orchestrator + Execution Types
// ---------------------------------------------------------------------------

// Stream parser result (final message from Claude Code)
export interface StreamResult {
  sessionId: string;
  result: string;
  isError: boolean;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  totalCostUsd: number;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
}

// Rate limit info from stream
export interface RateLimitInfo {
  status: string;
  resetsAt: number;
  rateLimitType: string;
}

// Per-turn token usage
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// Live token data for Socket.IO
export interface LiveTokenData {
  missionId: string;
  input: number;
  output: number;
  cacheHit: number;
  cacheCreation: number;
  costUsd: number;
}

// Merge result from worktree merger
export interface MergeResult {
  success: boolean;
  conflictResolved: boolean;
  conflictFiles?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Merge result metadata
// ---------------------------------------------------------------------------
export type MergeResultType = 'clean' | 'conflict_resolved' | 'failed';
