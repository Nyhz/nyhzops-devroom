'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { settings } from '@/lib/db/schema';
import { updateRulesOfEngagement } from '@/lib/settings/rules-of-engagement';

const ROE_KEY = 'rules_of_engagement';

export async function getRulesOfEngagementAction(): Promise<{
  value: string;
  updatedAt: number | null;
}> {
  const db = getDatabase();
  const row = db.select().from(settings).where(eq(settings.key, ROE_KEY)).get() as
    | { value: string; updatedAt: number }
    | undefined;
  return {
    value: row?.value ?? '',
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function updateRulesOfEngagementAction(value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('Update rules of engagement: value must not be empty');
  }
  updateRulesOfEngagement(value);
  revalidatePath('/assets');
}
