import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { NewCampaignForm } from './form';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function NewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { id } = await params;
  const { objective: prefillObjective, noteIds } = await searchParams;
  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, id)).get();

  return (
    <PageWrapper
      maxWidth
      breadcrumb={[bf?.codename ?? '', 'CAMPAIGNS']}
      title="NEW CAMPAIGN"
    >
      <NewCampaignForm
        battlefieldId={id}
        initialObjective={prefillObjective}
        noteIds={noteIds}
      />
    </PageWrapper>
  );
}
