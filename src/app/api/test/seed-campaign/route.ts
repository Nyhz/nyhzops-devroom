import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/index';
import { battlefields, campaigns, phases, missions, assets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateId } from '@/lib/utils';

/**
 * POST /api/test/seed-campaign
 *
 * Seeds a campaign in "planning" status with phases and missions,
 * ready for E2E testing of the launch and execution flow.
 *
 * Only available in development mode.
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
    }).run();
    asset = db.select().from(assets).where(eq(assets.id, assetId)).get()!;
  }

  // Create campaign in "planning" status
  const campaignId = generateId();
  db.insert(campaigns).values({
    id: campaignId,
    battlefieldId: battlefield.id,
    name: 'E2E Test Campaign',
    objective: 'Test campaign for E2E phase execution testing',
    status: 'planning',
    createdAt: now,
    updatedAt: now,
  }).run();

  // Create Phase 1 with 2 missions
  const phase1Id = generateId();
  db.insert(phases).values({
    id: phase1Id,
    campaignId,
    phaseNumber: 1,
    name: 'Reconnaissance',
    objective: 'Gather initial intelligence',
    status: 'standby',
    createdAt: now,
  }).run();

  const mission1Id = generateId();
  db.insert(missions).values({
    id: mission1Id,
    battlefieldId: battlefield.id,
    campaignId,
    phaseId: phase1Id,
    type: 'direct_action',
    title: 'Scout perimeter',
    briefing: 'Perform initial reconnaissance of the target area.',
    status: 'standby',
    priority: 'high',
    assetId: asset.id,
    createdAt: now,
    updatedAt: now,
  }).run();

  const mission2Id = generateId();
  db.insert(missions).values({
    id: mission2Id,
    battlefieldId: battlefield.id,
    campaignId,
    phaseId: phase1Id,
    type: 'direct_action',
    title: 'Identify targets',
    briefing: 'Identify key targets for the operation.',
    status: 'standby',
    priority: 'routine',
    assetId: asset.id,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Create Phase 2 with 1 mission
  const phase2Id = generateId();
  db.insert(phases).values({
    id: phase2Id,
    campaignId,
    phaseNumber: 2,
    name: 'Execution',
    objective: 'Execute the primary objective',
    status: 'standby',
    createdAt: now,
  }).run();

  const mission3Id = generateId();
  db.insert(missions).values({
    id: mission3Id,
    battlefieldId: battlefield.id,
    campaignId,
    phaseId: phase2Id,
    type: 'direct_action',
    title: 'Primary strike',
    briefing: 'Execute the primary objective.',
    status: 'standby',
    priority: 'critical',
    assetId: asset.id,
    createdAt: now,
    updatedAt: now,
  }).run();

  return NextResponse.json({
    battlefieldId: battlefield.id,
    campaignId,
    phase1Id,
    phase2Id,
    missionIds: [mission1Id, mission2Id, mission3Id],
  });
}

/**
 * DELETE /api/test/seed-campaign?campaignId=xxx
 *
 * Cleans up a seeded campaign and all its phases/missions.
 */
export async function DELETE(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }
  if (!process.env.E2E_TEST_MODE) {
    return NextResponse.json({ error: 'E2E_TEST_MODE not enabled' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaignId');
  if (!campaignId) {
    return NextResponse.json({ error: 'campaignId required' }, { status: 400 });
  }

  const db = getDatabase();

  // Delete missions, phases, then campaign
  const campaignPhases = db.select({ id: phases.id }).from(phases).where(eq(phases.campaignId, campaignId)).all();
  const phaseIds = campaignPhases.map((p) => p.id);

  if (phaseIds.length > 0) {
    for (const phaseId of phaseIds) {
      db.delete(missions).where(eq(missions.phaseId, phaseId)).run();
    }
    for (const phaseId of phaseIds) {
      db.delete(phases).where(eq(phases.id, phaseId)).run();
    }
  }

  db.delete(campaigns).where(eq(campaigns.id, campaignId)).run();

  return NextResponse.json({ deleted: true });
}
