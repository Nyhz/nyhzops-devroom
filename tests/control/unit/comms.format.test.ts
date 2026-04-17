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

  it('emits Bash tool_use with description when provided', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'pnpm build', description: 'Run build' },
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['⚙ Bash Run build']);
  });

  it('shortens file paths to parent/file for Read-style tools', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Read',
            input: { file_path: '/Users/a/b/c/src/x.ts' },
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['⚙ Read src/x.ts']);
  });

  it('annotates Edit with short path and +added/-removed line counts', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Edit',
            input: {
              file_path: '/Users/a/b/src/foo.ts',
              old_string: 'a\nb\nc',
              new_string: 'a\nb\nc\nd\ne',
            },
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['⚙ Edit src/foo.ts (+5 -3)']);
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
      '⚙ Read src/x.ts',
    ]);
  });

  it('drops tool_result entries — raw tool output is noise', () => {
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
    expect(formatCommsEvent(ev)).toEqual([]);
  });

  it('uses pattern (not path) for Grep', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Grep',
            input: { pattern: 'todo', path: '/a/b/src' },
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['⚙ Grep todo']);
  });

  it('shows Bash command when no description is provided', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'pnpm build' },
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['⚙ Bash pnpm build']);
  });

  it('strips <DEBRIEF> blocks from text parts so COMMS stays clean', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'Build passed.\n\n<DEBRIEF>\n{"summary":"x"}\n</DEBRIEF>',
          },
        ],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual(['Build passed.']);
  });

  it('suppresses a text part that is only a <DEBRIEF> block', () => {
    const ev = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: '<DEBRIEF>\n{"a":1}\n</DEBRIEF>' }],
      },
    } as unknown as StreamJsonEvent;
    expect(formatCommsEvent(ev)).toEqual([]);
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
