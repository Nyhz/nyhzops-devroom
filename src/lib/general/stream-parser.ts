import type { StreamResult, RateLimitInfo, TokenUsage } from '@/types';

type DeltaCallback = (text: string) => void;
type AssistantTurnCallback = (content: string) => void;
type ToolUseCallback = (tool: string, input: unknown) => void;
type ToolResultCallback = (toolId: string, result: string, isError: boolean) => void;
type ErrorCallback = (error: string) => void;
type ResultCallback = (result: StreamResult) => void;
type RateLimitCallback = (info: RateLimitInfo) => void;
type TokensCallback = (usage: TokenUsage) => void;

/**
 * Parses Claude Code `--output-format stream-json --include-partial-messages`
 * output line by line. Register callbacks, then feed lines from stdout.
 *
 * `any` is used intentionally for raw JSON parsing of external CLI output.
 */
export class StreamParser {
  private deltaCallbacks: DeltaCallback[] = [];
  private assistantTurnCallbacks: AssistantTurnCallback[] = [];
  private toolUseCallbacks: ToolUseCallback[] = [];
  private toolResultCallbacks: ToolResultCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];
  private resultCallbacks: ResultCallback[] = [];
  private rateLimitCallbacks: RateLimitCallback[] = [];
  private tokensCallbacks: TokensCallback[] = [];

  private sessionId: string | null = null;
  private lastAssistantMessageId: string | null = null;
  private lastAssistantTextLength = 0;

  onDelta(cb: DeltaCallback) { this.deltaCallbacks.push(cb); }
  onAssistantTurn(cb: AssistantTurnCallback) { this.assistantTurnCallbacks.push(cb); }
  onToolUse(cb: ToolUseCallback) { this.toolUseCallbacks.push(cb); }
  onToolResult(cb: ToolResultCallback) { this.toolResultCallbacks.push(cb); }
  onError(cb: ErrorCallback) { this.errorCallbacks.push(cb); }
  onResult(cb: ResultCallback) { this.resultCallbacks.push(cb); }
  onRateLimit(cb: RateLimitCallback) { this.rateLimitCallbacks.push(cb); }
  onTokens(cb: TokensCallback) { this.tokensCallbacks.push(cb); }

  getSessionId(): string | null { return this.sessionId; }

  feed(line: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    const type = parsed.type;

    switch (type) {
      case 'system':
        this.handleSystem(parsed);
        break;
      case 'stream_event':
        this.handleStreamEvent(parsed);
        break;
      case 'assistant':
        this.handleAssistant(parsed);
        break;
      case 'user':
        this.handleUser(parsed);
        break;
      case 'rate_limit_event':
        this.handleRateLimit(parsed);
        break;
      case 'result':
        this.handleResult(parsed);
        break;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSystem(msg: any): void {
    if (msg.subtype === 'init') {
      this.sessionId = msg.session_id;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleStreamEvent(msg: any): void {
    const event = msg.event;
    if (!event) return;

    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const text = event.delta.text;
      if (text) {
        this.deltaCallbacks.forEach(cb => cb(text));
      }
    }

    if (event.type === 'message_start' && event.message?.usage) {
      this.emitTokens(event.message.usage);
    }
    if (event.type === 'message_delta' && event.usage) {
      this.emitTokens(event.usage);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAssistant(msg: any): void {
    const message = msg.message;
    if (!message?.content) return;

    const messageId = message.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlocks = message.content.filter((b: any) => b.type === 'text');
    if (textBlocks.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fullText = textBlocks.map((b: any) => b.text).join('');

      // Deduplicate: only emit if this is a new message or text has grown
      if (messageId !== this.lastAssistantMessageId || fullText.length > this.lastAssistantTextLength) {
        this.lastAssistantMessageId = messageId;
        this.lastAssistantTextLength = fullText.length;
        this.assistantTurnCallbacks.forEach(cb => cb(fullText));
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolBlocks = message.content.filter((b: any) => b.type === 'tool_use');
    for (const tool of toolBlocks) {
      this.toolUseCallbacks.forEach(cb => cb(tool.name, tool.input));
    }

    if (message.usage) {
      this.emitTokens(message.usage);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleUser(msg: any): void {
    const content = msg.message?.content;
    if (!content) return;

    for (const block of content) {
      if (block.type === 'tool_result') {
        this.toolResultCallbacks.forEach(cb =>
          cb(block.tool_use_id, String(block.content || ''), !!block.is_error)
        );
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleRateLimit(msg: any): void {
    const info = msg.rate_limit_info;
    if (info) {
      this.rateLimitCallbacks.forEach(cb => cb({
        status: info.status,
        resetsAt: info.resetsAt,
        rateLimitType: info.rateLimitType || info.rate_limit_type || '',
      }));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleResult(msg: any): void {
    const result: StreamResult = {
      sessionId: msg.session_id || this.sessionId || '',
      result: msg.result || '',
      isError: !!msg.is_error,
      durationMs: msg.duration_ms || 0,
      durationApiMs: msg.duration_api_ms || 0,
      numTurns: msg.num_turns || 0,
      totalCostUsd: msg.total_cost_usd || 0,
      stopReason: msg.stop_reason || '',
      usage: {
        inputTokens: msg.usage?.input_tokens || 0,
        outputTokens: msg.usage?.output_tokens || 0,
        cacheCreationTokens: msg.usage?.cache_creation_input_tokens || 0,
        cacheReadTokens: msg.usage?.cache_read_input_tokens || 0,
      },
    };
    this.resultCallbacks.forEach(cb => cb(result));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emitTokens(usage: any): void {
    if (!usage) return;
    const tokens: TokenUsage = {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
    };
    this.tokensCallbacks.forEach(cb => cb(tokens));
  }
}
