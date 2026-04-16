/**
 * Debrief schema — structured JSON block emitted by combat assets at mission end.
 *
 * zod is not currently a project dependency, so this module hand-rolls
 * validation with the same contract as the planned zod schema. Returns
 * narrowed, typed objects on success and descriptive reasons on failure.
 */

export type DebriefConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type OpenQuestionSeverity = 'low' | 'medium' | 'high';

export interface OpenQuestion {
  title: string;
  description: string;
  severity: OpenQuestionSeverity;
}

export interface Debrief {
  summary: string;
  commits: string[];
  files_touched: string[];
  confidence: DebriefConfidence;
  open_questions: OpenQuestion[];
}

export type DebriefValidation =
  | { success: true; data: Debrief }
  | { success: false; error: { message: string } };

const CONFIDENCE: readonly DebriefConfidence[] = ['high', 'medium', 'low', 'unknown'];
const SEVERITY: readonly OpenQuestionSeverity[] = ['low', 'medium', 'high'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validateOpenQuestion(v: unknown, idx: number): OpenQuestion | string {
  if (!isRecord(v)) return `open_questions[${idx}]: expected object`;
  const { title, description, severity } = v;
  if (typeof title !== 'string') return `open_questions[${idx}].title: expected string`;
  if (typeof description !== 'string') return `open_questions[${idx}].description: expected string`;
  if (typeof severity !== 'string' || !SEVERITY.includes(severity as OpenQuestionSeverity)) {
    return `open_questions[${idx}].severity: expected one of ${SEVERITY.join('|')}`;
  }
  return { title, description, severity: severity as OpenQuestionSeverity };
}

export const DebriefSchema = {
  safeParse(input: unknown): DebriefValidation {
    if (!isRecord(input)) {
      return { success: false, error: { message: 'expected object at root' } };
    }
    const { summary, commits, files_touched, confidence, open_questions } = input;

    if (typeof summary !== 'string' || summary.length < 1) {
      return { success: false, error: { message: 'summary: expected non-empty string' } };
    }
    if (!isStringArray(commits)) {
      return { success: false, error: { message: 'commits: expected string[]' } };
    }
    if (!isStringArray(files_touched)) {
      return { success: false, error: { message: 'files_touched: expected string[]' } };
    }
    if (typeof confidence !== 'string' || !CONFIDENCE.includes(confidence as DebriefConfidence)) {
      return {
        success: false,
        error: { message: `confidence: expected one of ${CONFIDENCE.join('|')}` },
      };
    }

    let openQuestions: OpenQuestion[] = [];
    if (open_questions !== undefined) {
      if (!Array.isArray(open_questions)) {
        return { success: false, error: { message: 'open_questions: expected array' } };
      }
      const collected: OpenQuestion[] = [];
      for (let i = 0; i < open_questions.length; i++) {
        const parsed = validateOpenQuestion(open_questions[i], i);
        if (typeof parsed === 'string') {
          return { success: false, error: { message: parsed } };
        }
        collected.push(parsed);
      }
      openQuestions = collected;
    }

    return {
      success: true,
      data: {
        summary,
        commits,
        files_touched,
        confidence: confidence as DebriefConfidence,
        open_questions: openQuestions,
      },
    };
  },
};
