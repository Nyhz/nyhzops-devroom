const HEADING_PATTERN = /^#{2,3}\s*(?:Recommended\s+)?(?:Next|Follow[- ]?up)\s*(?:Actions|Steps)/im;
const NEXT_HEADING_PATTERN = /^#{2,3}\s/m;
const BULLET_PATTERN = /^[-*]\s+(.+)$/;

export function extractNextActions(debrief: string | null | undefined): string[] {
  if (!debrief) return [];

  const headingMatch = HEADING_PATTERN.exec(debrief);
  if (!headingMatch) return [];

  const afterHeading = debrief.slice(headingMatch.index + headingMatch[0].length);
  const lines = afterHeading.split('\n');

  const actions: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (NEXT_HEADING_PATTERN.test(trimmed)) break;

    if (trimmed === '' || trimmed.startsWith('  ')) continue;

    const bulletMatch = BULLET_PATTERN.exec(trimmed);
    if (bulletMatch) {
      const cleaned = bulletMatch[1].trim().replace(/\.+$/, '');
      if (cleaned) actions.push(cleaned);
    }
  }

  return actions;
}
