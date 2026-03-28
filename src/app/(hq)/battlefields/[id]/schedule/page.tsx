import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { assets, battlefields, campaigns } from '@/lib/db/schema';
import { listScheduledTasks } from '@/actions/schedule';
import { ScheduleList } from '@/components/schedule/schedule-list';
import { PageWrapper } from '@/components/layout/page-wrapper';
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
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, battlefieldId)).get();
  const campaignTemplates = db
    .select()
    .from(campaigns)
    .where(eq(campaigns.isTemplate, 1))
    .all() as Campaign[];

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'SCHEDULE']}
      title="SCHEDULE"
    >
      <ScheduleList
        tasks={tasks}
        battlefieldId={battlefieldId}
        assets={allAssets}
        campaignTemplates={campaignTemplates}
      />
    </PageWrapper>
  );
}
