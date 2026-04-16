import { describe, it, expect } from 'vitest';
import { parseDebrief } from '@/control/debrief/parse';

const valid = `Some text before\n<DEBRIEF>\n${JSON.stringify({
  summary: 'did it',
  commits: ['abc123def456'],
  files_touched: ['a.ts'],
  confidence: 'high',
  open_questions: [],
})}\n</DEBRIEF>\nmore after`;

describe('parseDebrief', () => {
  it('extracts and validates a well-formed block', () => {
    const r = parseDebrief(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.summary).toBe('did it');
  });
  it('returns not-ok when no block', () => {
    expect(parseDebrief('just prose').ok).toBe(false);
  });
  it('returns not-ok when block present but JSON invalid', () => {
    expect(parseDebrief('<DEBRIEF>not json</DEBRIEF>').ok).toBe(false);
  });
  it('returns not-ok when schema invalid', () => {
    expect(parseDebrief('<DEBRIEF>{"summary":""}</DEBRIEF>').ok).toBe(false);
  });
});
