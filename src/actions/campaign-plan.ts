'use server';

import { eq } from 'drizzle-orm';
import { getDatabase, getOrThrow } from '@/lib/db/index';
import { campaigns } from '@/lib/db/schema';
import { emitStatusChange } from '@/lib/socket/emit';
import { revalidatePath } from 'next/cache';
import type { PlanJSON } from '@/types';
import { revalidateCampaignPaths, insertPlanFromJSON, deletePlanData } from './campaign-helpers';

// ---------------------------------------------------------------------------
// updateBattlePlan
// ---------------------------------------------------------------------------

export async function updateBattlePlan(
  campaignId: string,
  plan: PlanJSON,
): Promise<void> {
  const db = getDatabase();

  const campaign = getOrThrow(campaigns, campaignId, 'updateBattlePlan');
  if (campaign.status !== 'planning') {
    throw new Error(
      `updateBattlePlan: can only update plan for planning campaigns (current: ${campaign.status})`,
    );
  }

  // Delete existing plan data
  deletePlanData(campaignId);

  // Insert new plan
  insertPlanFromJSON(campaignId, campaign.battlefieldId, plan);

  // Update campaign timestamp
  db.update(campaigns)
    .set({ updatedAt: Date.now() })
    .where(eq(campaigns.id, campaignId))
    .run();

  revalidateCampaignPaths(campaign.battlefieldId, campaignId);
}

// ---------------------------------------------------------------------------
// backToDraft
// ---------------------------------------------------------------------------

export async function backToDraft(campaignId: string): Promise<void> {
  const db = getDatabase();
  const campaign = getOrThrow(campaigns, campaignId, 'backToDraft');
  if (campaign.status !== 'planning') throw new Error('backToDraft: can only go back to draft from planning');

  db.update(campaigns).set({
    status: 'draft',
    updatedAt: Date.now(),
  }).where(eq(campaigns.id, campaignId)).run();

  emitStatusChange('campaign', campaignId, 'draft');
  revalidatePath(`/battlefields/${campaign.battlefieldId}/campaigns/${campaignId}`);
}
