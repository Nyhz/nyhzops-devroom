import { describe, it, expect } from 'vitest';
import { formatCommsEvent } from '@/control/comms';
import type { StreamJsonEvent } from '@/control/spawn-asset';

describe('formatCommsEvent — real Claude stream-json shape', () => {
  it('extracts text from nested assistant.message.content[]', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Adding health route now.' }],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['Adding health route now.']);
  });

  it('extracts tool_use from nested assistant content', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'pnpm build' },
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['⚙ Bash: pnpm build']);
  });

  it('emits one message per content part, preserving order', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: "I'll read the file." },
          {
            type: 'tool_use',
            id: 't1',
            name: 'Read',
            input: { file_path: 'src/x.ts' },
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual([
      "I'll read the file.",
      '⚙ Read: src/x.ts',
    ]);
  });

  it('extracts tool_result from nested user.message.content[]', () => {
    const ev = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: 'file contents here',
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['✓ result: file contents here']);
  });

  it('marks errored tool_result with ✗', () => {
    const ev = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: 'boom',
            is_error: true,
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['✗ result: boom']);
  });

  it('supports legacy flat assistant shape (back-compat with test fixtures)', () => {
    const ev = { type: 'assistant', text: 'Starting task' } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['Starting task']);
  });

  it('returns [] for system / stream_event / result', () => {
    expect(formatCommsEvent({ type: 'system' } as StreamJsonEvent)).toEqual([]);
    expect(formatCommsEvent({ type: 'stream_event' } as StreamJsonEvent)).toEqual([]);
    expect(formatCommsEvent({ type: 'result' } as StreamJsonEvent)).toEqual([]);
  });

  it('returns [] for assistant with empty content array', () => {
    const ev = {
      type: 'assistant',
      message: { content: [] },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual([]);
  });
});
