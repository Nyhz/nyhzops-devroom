import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { assets, campaigns, scheduledTasks } from '@/lib/db/schema';
import { listScheduledTasks } from '@/actions/schedule';
import { ScheduleList } from '@/components/schedule/schedule-list';
import type { Asset, Campaign } from '@/types';

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: battlefieldId } = await params;

  const tasks = await listScheduledTasks(battlefieldId);

  const db = getDatabase();
  const allAssets = db.select().from(assets).all() as Asset[];
  const campaignTemplates = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.isTemplate, 1))
    .all() as Campaign[];

  return (
    <div className="p-8 space-y-6">
      <ScheduleList
        tasks={tasks}
        battlefieldId={battlefieldId}
        assets={allAssets}
        campaignTemplates={campaignTemplates}
      />
    </div>
  );
}
