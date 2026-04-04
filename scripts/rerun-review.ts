import { reviewDebrief } from '../src/lib/overseer/debrief-reviewer';
import { storeOverseerLog } from '../src/lib/overseer/overseer-db';
import { getDatabase } from '../src/lib/db/index';
import { missions, battlefields } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import simpleGit from 'simple-git';
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
  const claudeMdPath = bf.claudeMdPath || path.join(bf.repoPath, 'CLAUDE.md');
  const claudeMd = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf-8') : null;

  // Get git diffs for code review context
  let gitDiffStat: string | null = null;
  let gitDiff: string | null = null;

  if (mission.worktreeBranch && bf.repoPath) {
    try {
      const git = simpleGit(bf.repoPath);
      const target = bf.defaultBranch || 'main';
      gitDiffStat = await git.diff(['--stat', `${target}...${mission.worktreeBranch}`]);
      gitDiff = await git.diff([`${target}...${mission.worktreeBranch}`]);
    } catch (err) {
      console.warn('Could not get git diff:', err);
    }
  }

  console.log(`Reviewing mission: ${mission.title}`);
  console.log(`Debrief length: ${mission.debrief.length} chars`);
  console.log(`CLAUDE.md: ${claudeMd ? `${claudeMd.length} chars` : 'not found'}`);
  console.log(`Git diff: ${gitDiff ? `${gitDiff.length} chars` : 'not available'}`);
  console.log('Running review...\n');

  const review = await reviewDebrief({
    missionBriefing: mission.briefing,
    missionDebrief: mission.debrief,
    claudeMd,
    gitDiffStat,
    gitDiff,
    missionId: mission.id,
    battlefieldId: mission.battlefieldId,
  });

  console.log('Review result:', JSON.stringify(review, null, 2));

  storeOverseerLog({
    missionId: mission.id,
    battlefieldId: mission.battlefieldId,
    campaignId: mission.campaignId,
    question: `[DEBRIEF_REVIEW] Mission: ${mission.title}`,
    answer: review.verdict === 'approve'
      ? 'Approved'
      : `Concerns: ${review.concerns.join(', ')}`,
    reasoning: review.reasoning,
    confidence: review.verdict === 'approve' ? 'high' : 'medium',
    escalated: review.verdict === 'escalate' ? 1 : 0,
  });

  console.log('\nOverseer log stored.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
