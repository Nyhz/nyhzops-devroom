import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { NewCampaignForm } from './form';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function NewCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, id)).get();

  return (
    <PageWrapper
      maxWidth
      breadcrumb={[bf?.codename ?? '', 'CAMPAIGNS']}
      title="NEW CAMPAIGN"
    >
      <NewCampaignForm battlefieldId={id} />
    </PageWrapper>
  );
}
