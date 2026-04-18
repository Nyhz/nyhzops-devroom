import { onMissionTerminal } from '../src/control/campaign/executor';

const missionId = process.argv[2];
if (!missionId) {
  console.error('usage: tsx scripts/unblock-phase.ts <missionId>');
  process.exit(1);
}

console.log(`firing onMissionTerminal(${missionId})…`);
onMissionTerminal(missionId);
console.log('done');
