import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/index';
import { battlefields, campaigns, phases, missions, assets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateId } from '@/lib/utils';

/**
 * POST /api/test/seed-active-campaign
 *
 * Seeds an active campaign where Phase 1 has a compromised mission,
 * ready for testing commanderOverride, skipMission, and abandon flows.
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }
  if (!process.env.E2E_TEST_MODE) {
    return NextResponse.json({ error: 'E2E_TEST_MODE not enabled' }, { status: 403 });
  }

  const db = getDatabase();
  const now = Date.now();

  // Find or create a battlefield
  let battlefield = db.select().from(battlefields).limit(1).get();
  if (!battlefield) {
    const bfId = generateId();
    db.insert(battlefields).values({
      id: bfId,
      name: 'E2E Test Battlefield',
      codename: 'E2E-TEST',
      repoPath: process.cwd(),
      defaultBranch: 'main',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).run();
    battlefield = db.select().from(battlefields).where(eq(battlefields.id, bfId)).get()!;
  }

  // Find or create an asset
  let asset = db.select().from(assets).where(eq(assets.status, 'active')).limit(1).get();
  if (!asset) {
    const assetId = generateId();
    db.insert(assets).values({
      id: assetId,
      codename: 'OPERATIVE',
      specialty: 'mission execution',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).run();
    asset = db.select().from(assets).where(eq(assets.id, assetId)).get()!;
  }

  // Create campaign in "active" status
  const campaignId = generateId();
  db.insert(campaigns).values({
    id: campaignId,
    battlefieldId: battlefield.id,
    name: 'E2E Active Campaign',
    objective: 'Active campaign for E2E override and abandon testing',
    status: 'active',
    currentPhase: 1,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Phase 1: one accomplished, one compromised
  const phase1Id = generateId();
  db.insert(phases).values({
    id: phase1Id,
    campaignId,
    phaseNumber: 1,
    name: 'Initial Assault',
    objective: 'Execute initial phase',
    status: 'active',
    createdAt: now,
  }).run();

  const accomplishedMissionId = generateId();
  db.insert(missions).values({
    id: accomplishedMissionId,
    battlefieldId: battlefield.id,
    campaignId,
    phaseId: phase1Id,
    type: 'standard',
    title: 'Completed recon',
    briefing: 'This mission was completed successfully.',
    status: 'accomplished',
    priority: 'high',
    assetId: asset.id,
    debrief: '## Debrief\n\nMission accomplished. All targets identified.',
    completedAt: now - 60000,
    createdAt: now - 120000,
    updatedAt: now - 60000,
  }).run();

  const compromisedMissionId = generateId();
  db.insert(missions).values({
    id: compromisedMissionId,
    battlefieldId: battlefield.id,
    campaignId,
    phaseId: phase1Id,
    type: 'standard',
    title: 'Failed extraction',
    briefing: 'Extract data from the target system.',
    status: 'compromised',
    priority: 'critical',
    assetId: asset.id,
    debrief: '## Debrief\n\nMission failed. Target system was unreachable.',
    completedAt: now - 30000,
    createdAt: now - 120000,
    updatedAt: now - 30000,
  }).run();

  // Phase 2: standby with one mission
  const phase2Id = generateId();
  db.insert(phases).values({
    id: phase2Id,
    campaignId,
    phaseNumber: 2,
    name: 'Follow-up',
    objective: 'Execute follow-up operations',
    status: 'standby',
    createdAt: now,
  }).run();

  const standbyMissionId = generateId();
  db.insert(missions).values({
    id: standbyMissionId,
    battlefieldId: battlefield.id,
    campaignId,
    phaseId: phase2Id,
    type: 'standard',
    title: 'Final sweep',
    briefing: 'Complete the final sweep of the area.',
    status: 'standby',
    priority: 'normal',
    assetId: asset.id,
    createdAt: now,
    updatedAt: now,
  }).run();

  return NextResponse.json({
    battlefieldId: battlefield.id,
    campaignId,
    phase1Id,
    phase2Id,
    accomplishedMissionId,
    compromisedMissionId,
    standbyMissionId,
  });
}
