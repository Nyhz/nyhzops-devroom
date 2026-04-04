import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/index';
import { battlefields, campaigns, phases, missions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

/**
 * Test fixture API — only available in development/test mode.
 * POST /api/test-fixtures
 *
 * Creates test data for E2E tests. Supports:
 * - { action: 'create-planning-campaign', battlefieldId } — creates a campaign in planning status with phases/missions
 * - { action: 'get-battlefield' } — returns the first active battlefield
 * - { action: 'cleanup', prefix } — deletes test entities whose names start with prefix
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }
  if (!process.env.E2E_TEST_MODE) {
    return NextResponse.json({ error: 'E2E_TEST_MODE not enabled' }, { status: 403 });
  }

  const body = await request.json();
  const db = getDatabase();

  switch (body.action) {
    case 'get-battlefield': {
      const bf = db.select().from(battlefields).where(eq(battlefields.status, 'active')).limit(1).all()[0];
      return NextResponse.json({ battlefield: bf ?? null });
    }

    case 'create-planning-campaign': {
      const { battlefieldId } = body;
      if (!battlefieldId) {
        return NextResponse.json({ error: 'battlefieldId required' }, { status: 400 });
      }

      const now = Date.now();
      const campaignId = ulid();

      db.insert(campaigns).values({
        id: campaignId,
        battlefieldId,
        name: 'E2E Test Campaign Plan',
        objective: 'E2E test campaign for plan editor testing',
        status: 'planning',
        isTemplate: 0,
        createdAt: now,
        updatedAt: now,
      }).run();

      return NextResponse.json({ campaignId, battlefieldId });
    }

    case 'cleanup': {
      const { prefix } = body;
      if (!prefix) {
        return NextResponse.json({ error: 'prefix required' }, { status: 400 });
      }

      // Delete campaigns matching prefix
      const matchingCampaigns = db.select({ id: campaigns.id })
        .from(campaigns)
        .all()
        .filter(c => {
          const campaign = db.select({ name: campaigns.name }).from(campaigns).where(eq(campaigns.id, c.id)).get();
          return campaign?.name?.startsWith(prefix);
        });

      for (const c of matchingCampaigns) {
        // Delete missions, phases, then campaign
        const campaignPhases = db.select({ id: phases.id }).from(phases).where(eq(phases.campaignId, c.id)).all();
        for (const p of campaignPhases) {
          db.delete(missions).where(eq(missions.phaseId, p.id)).run();
        }
        db.delete(phases).where(eq(phases.campaignId, c.id)).run();
        db.delete(campaigns).where(eq(campaigns.id, c.id)).run();
      }

      return NextResponse.json({ deleted: matchingCampaigns.length });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
