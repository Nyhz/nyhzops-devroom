import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { listScheduledTasks } from '@/actions/schedule';
import { ScheduleList } from '@/components/schedule/schedule-list';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: battlefieldId } = await params;

  const tasks = await listScheduledTasks(battlefieldId);

  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, battlefieldId)).get();

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'SCHEDULE']}
      title="SCHEDULE"
    >
      <ScheduleList
        tasks={tasks}
        battlefieldId={battlefieldId}
      />
    </PageWrapper>
  );
}
