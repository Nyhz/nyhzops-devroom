import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { listBoardNotes } from '@/actions/intel';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { IntelBoard } from '@/components/board/intel-board';
import type { Battlefield } from '@/types';

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get() as Battlefield | undefined;

  if (!battlefield || battlefield.status !== 'active') {
    notFound();
  }

  const notes = await listBoardNotes(id);

  return (
    <PageWrapper breadcrumb={battlefield.codename} title="INTEL BOARD">
      <IntelBoard battlefieldId={id} initialNotes={notes} />
    </PageWrapper>
  );
}
