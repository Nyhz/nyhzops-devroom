import { DebriefSchema, Debrief } from './schema';

export type ParseResult =
  | { ok: true; data: Debrief }
  | { ok: false; reason: string };

export function parseDebrief(finalMessage: string): ParseResult {
  const match = finalMessage.match(/<DEBRIEF>([\s\S]*?)<\/DEBRIEF>/);
  if (!match) return { ok: false, reason: 'block missing' };
  let raw: unknown;
  try {
    raw = JSON.parse(match[1].trim());
  } catch (err) {
    return { ok: false, reason: `json parse: ${(err as Error).message}` };
  }
  const parsed = DebriefSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: `schema: ${parsed.error.message}` };
  return { ok: true, data: parsed.data };
}
