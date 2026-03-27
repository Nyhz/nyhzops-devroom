import { reviewDebrief } from '../src/lib/captain/debrief-reviewer';
import { storeCaptainLog } from '../src/lib/captain/captain-db';
import { getDatabase } from '../src/lib/db/index';
import { missions, battlefields } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

const missionId = process.argv[2];
if (!missionId) {
  console.error('Usage: npx tsx scripts/rerun-review.ts <missionId>');
  process.exit(1);
}

async function main() {
  const db = getDatabase();
  const mission = db.select().from(missions).where(eq(missions.id, missionId)).get();
  if (!mission) {
    console.error('Mission not found:', missionId);
    process.exit(1);
  }
  if (!mission.debrief) {
    console.error('Mission has no debrief');
    process.exit(1);
  }

  const bf = db.select().from(battlefields).where(eq(battlefields.id, mission.battlefieldId)).get()!;
  const claudeMdPath = path.join(bf.repoPath, 'CLAUDE.md');
  const claudeMd = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf-8') : null;

  console.log(`Reviewing mission: ${mission.title}`);
  console.log(`Debrief length: ${mission.debrief.length} chars`);
  console.log(`CLAUDE.md: ${claudeMd ? `${claudeMd.length} chars` : 'not found'}`);
  console.log('Running review...\n');

  const review = await reviewDebrief({
    missionBriefing: mission.briefing,
    missionDebrief: mission.debrief,
    claudeMd,
    missionId: mission.id,
    battlefieldId: mission.battlefieldId,
  });

  console.log('Review result:', JSON.stringify(review, null, 2));

  storeCaptainLog({
    missionId: mission.id,
    battlefieldId: mission.battlefieldId,
    campaignId: mission.campaignId,
    question: `[DEBRIEF_REVIEW] Mission: ${mission.title}`,
    answer: review.satisfactory ? 'Satisfactory' : `Concerns: ${review.concerns.join(', ')}`,
    reasoning: review.reasoning,
    confidence: review.satisfactory ? 'high' : 'medium',
    escalated: review.recommendation === 'escalate' ? 1 : 0,
  });

  console.log('\nCaptain log stored.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
