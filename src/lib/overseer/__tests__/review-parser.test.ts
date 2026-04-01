import { describe, it, expect } from 'vitest';
import { parseReviewOutput } from '../review-parser';

describe('parseReviewOutput', () => {
  describe('clean structured output envelope', () => {
    it('returns ok with review when subtype is success and structured_output is valid', () => {
      const input = JSON.stringify({
        subtype: 'success',
        structured_output: {
          verdict: 'approve',
          concerns: ['Minor style drift'],
          reasoning: 'Task completed as specified.',
        },
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.verdict).toBe('approve');
        expect(result.review.concerns).toEqual(['Minor style drift']);
        expect(result.review.reasoning).toBe('Task completed as specified.');
      }
    });

    it('returns ok with retry verdict from envelope', () => {
      const input = JSON.stringify({
        subtype: 'success',
        structured_output: {
          verdict: 'retry',
          concerns: ['Tests not run', 'Build broken'],
          reasoning: 'Agent did not verify the implementation.',
        },
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.verdict).toBe('retry');
        expect(result.review.concerns).toHaveLength(2);
      }
    });
  });

  describe('envelope with error subtype', () => {
    it('returns escalate fallback when subtype is not success', () => {
      const input = JSON.stringify({
        subtype: 'error',
        is_error: true,
        result: 'Rate limit exceeded',
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fallback.verdict).toBe('escalate');
        expect(result.diagnostic).toContain('error');
      }
    });

    it('returns escalate fallback when subtype is success but structured_output is missing', () => {
      const input = JSON.stringify({
        subtype: 'success',
        result: 'some text output',
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fallback.verdict).toBe('escalate');
        expect(result.diagnostic).toBeDefined();
      }
    });
  });

  describe('JSON embedded in prose (markdown code block)', () => {
    it('extracts review from markdown json code block', () => {
      const input = `The mission was completed. Here is my assessment:

\`\`\`json
{
  "verdict": "approve",
  "concerns": [],
  "reasoning": "All tasks completed successfully."
}
\`\`\`

End of review.`;

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.verdict).toBe('approve');
        expect(result.review.concerns).toEqual([]);
        expect(result.review.reasoning).toBe('All tasks completed successfully.');
      }
    });

    it('extracts review from bare JSON object in prose', () => {
      const input = `Assessment complete. {"verdict": "retry", "concerns": ["Tests failed"], "reasoning": "Build did not pass."} Please review.`;

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.verdict).toBe('retry');
        expect(result.review.concerns).toEqual(['Tests failed']);
      }
    });
  });

  describe('concerns coercion', () => {
    it('wraps single string concern in array', () => {
      const input = JSON.stringify({
        subtype: 'success',
        structured_output: {
          verdict: 'approve',
          concerns: 'Some concern as a string',
          reasoning: 'Mostly fine.',
        },
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.concerns).toEqual(['Some concern as a string']);
      }
    });

    it('defaults missing concerns to empty array', () => {
      const input = JSON.stringify({
        subtype: 'success',
        structured_output: {
          verdict: 'escalate',
          reasoning: 'Something serious.',
        },
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.concerns).toEqual([]);
      }
    });
  });

  describe('reasoning defaults', () => {
    it('defaults missing reasoning to "No reasoning provided"', () => {
      const input = JSON.stringify({
        subtype: 'success',
        structured_output: {
          verdict: 'approve',
          concerns: [],
        },
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.reasoning).toBe('No reasoning provided');
      }
    });
  });

  describe('invalid verdict', () => {
    it('returns escalate fallback when verdict is unrecognized', () => {
      const input = JSON.stringify({
        subtype: 'success',
        structured_output: {
          verdict: 'unknown_verdict',
          concerns: [],
          reasoning: 'Some reasoning.',
        },
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fallback.verdict).toBe('escalate');
        expect(result.diagnostic).toContain('verdict');
      }
    });

    it('returns escalate fallback when verdict is missing entirely', () => {
      const input = JSON.stringify({
        subtype: 'success',
        structured_output: {
          concerns: ['Something happened'],
          reasoning: 'But no verdict.',
        },
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fallback.verdict).toBe('escalate');
      }
    });
  });

  describe('complete garbage input', () => {
    it('returns escalate fallback for totally unparseable input', () => {
      const input = 'ERROR: connection timeout — no output received';

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fallback.verdict).toBe('escalate');
        expect(result.diagnostic).toBeDefined();
        expect(result.diagnostic.length).toBeGreaterThan(0);
      }
    });

    it('returns escalate fallback for empty string', () => {
      const result = parseReviewOutput('');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fallback.verdict).toBe('escalate');
      }
    });
  });

  describe('legacy recommendation field', () => {
    it('maps recommendation "accept" to verdict "approve"', () => {
      const input = JSON.stringify({
        subtype: 'success',
        structured_output: {
          recommendation: 'accept',
          concerns: [],
          reasoning: 'Looks good.',
        },
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.verdict).toBe('approve');
      }
    });

    it('maps legacy recommendation "retry" to verdict "retry"', () => {
      const input = JSON.stringify({
        recommendation: 'retry',
        concerns: ['Task incomplete'],
        reasoning: 'Agent did not finish.',
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.verdict).toBe('retry');
      }
    });

    it('maps legacy recommendation "escalate" to verdict "escalate"', () => {
      const input = JSON.stringify({
        verdict: 'escalate',
        concerns: ['Critical issue'],
        reasoning: 'Commander must decide.',
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.verdict).toBe('escalate');
      }
    });
  });

  describe('direct JSON object (no envelope)', () => {
    it('parses a direct review object with no envelope wrapper', () => {
      const input = JSON.stringify({
        verdict: 'approve',
        concerns: ['Minor issue'],
        reasoning: 'Completed satisfactorily.',
      });

      const result = parseReviewOutput(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.verdict).toBe('approve');
        expect(result.review.concerns).toEqual(['Minor issue']);
        expect(result.review.reasoning).toBe('Completed satisfactorily.');
      }
    });
  });
});
