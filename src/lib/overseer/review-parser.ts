import type { OverseerReview } from '@/types';

type ParseResult =
  | { ok: true; review: OverseerReview }
  | { ok: false; fallback: OverseerReview; diagnostic: string };

const ESCALATE_FALLBACK: OverseerReview = {
  verdict: 'escalate',
  concerns: ['Overseer review output could not be parsed — escalating to Commander'],
  reasoning: 'Review parse failure — Commander should decide',
  parseFailure: true,
};

function escalateFallback(diagnostic: string): ParseResult {
  return { ok: false, fallback: ESCALATE_FALLBACK, diagnostic };
}

const VALID_VERDICTS = new Set(['approve', 'retry', 'escalate']);

const VERDICT_ALIASES: Record<string, OverseerReview['verdict']> = {
  accept: 'approve',
  approve: 'approve',
  retry: 'retry',
  escalate: 'escalate',
};

function extractVerdict(obj: Record<string, unknown>): OverseerReview['verdict'] | null {
  // Check verdict field first, then fall back to legacy recommendation
  const raw = obj['verdict'] ?? obj['recommendation'];
  if (typeof raw !== 'string') return null;
  return VERDICT_ALIASES[raw.toLowerCase()] ?? null;
}

function extractConcerns(obj: Record<string, unknown>): string[] {
  const raw = obj['concerns'];
  if (Array.isArray(raw)) {
    return raw.filter((c): c is string => typeof c === 'string');
  }
  if (typeof raw === 'string') {
    return [raw];
  }
  return [];
}

function extractReasoning(obj: Record<string, unknown>): string {
  const raw = obj['reasoning'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return 'No reasoning provided';
}

function extractReview(
  obj: Record<string, unknown>,
): { ok: true; review: OverseerReview } | { ok: false; diagnostic: string } {
  const verdict = extractVerdict(obj);
  if (!verdict || !VALID_VERDICTS.has(verdict)) {
    const found = obj['verdict'] ?? obj['recommendation'];
    return {
      ok: false,
      diagnostic: `Invalid or missing verdict: ${JSON.stringify(found)}`,
    };
  }

  return {
    ok: true,
    review: {
      verdict,
      concerns: extractConcerns(obj),
      reasoning: extractReasoning(obj),
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tryExtractFromProse(raw: string): Record<string, unknown> | null {
  // Try markdown code block first: ```json ... ```
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (codeBlockMatch?.[1]) {
    const parsed = tryParseJson(codeBlockMatch[1].trim());
    if (isPlainObject(parsed)) return parsed;
  }

  // Try extracting a bare {...} object from the text
  const braceMatch = /\{[\s\S]*\}/u.exec(raw);
  if (braceMatch) {
    const parsed = tryParseJson(braceMatch[0]);
    if (isPlainObject(parsed)) return parsed;
  }

  return null;
}

export function parseReviewOutput(raw: string): ParseResult {
  if (!raw || raw.trim().length === 0) {
    return escalateFallback('Empty output received from Overseer');
  }

  // Step 1: Try direct JSON parse
  const directParsed = tryParseJson(raw.trim());
  if (isPlainObject(directParsed)) {
    // Check if it's an envelope (has subtype field)
    if ('subtype' in directParsed) {
      const subtype = directParsed['subtype'];
      const structuredOutput = directParsed['structured_output'];

      if (subtype === 'success' && isPlainObject(structuredOutput)) {
        // Extract review from structured_output
        const result = extractReview(structuredOutput);
        if (result.ok) return { ok: true, review: result.review };
        return escalateFallback(result.diagnostic);
      }

      // Envelope error or missing structured_output
      const resultText = typeof directParsed['result'] === 'string'
        ? directParsed['result'].slice(0, 200)
        : '';
      const isError = directParsed['is_error'];
      return escalateFallback(
        `Envelope subtype="${String(subtype)}", is_error=${String(isError)}, result="${resultText}"`,
      );
    }

    // Direct object (no envelope) — extract review directly
    const result = extractReview(directParsed);
    if (result.ok) return { ok: true, review: result.review };
    return escalateFallback(result.diagnostic);
  }

  // Step 2: Try extracting JSON from prose
  const extracted = tryExtractFromProse(raw);
  if (extracted) {
    const result = extractReview(extracted);
    if (result.ok) return { ok: true, review: result.review };
    return escalateFallback(result.diagnostic);
  }

  // Step 3: Complete failure
  const snippet = raw.slice(0, 200);
  return escalateFallback(`Could not extract valid JSON from output: "${snippet}"`);
}
