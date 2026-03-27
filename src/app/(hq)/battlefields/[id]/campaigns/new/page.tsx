import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { NewCampaignForm } from './form';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { PageHeader } from '@/components/layout/page-header';

export default async function NewCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, id)).get();

  return (
    <PageWrapper maxWidth className="flex flex-col gap-6">
      <PageHeader codename={bf?.codename ?? ''} section="CAMPAIGNS" title="New Campaign" />
      <NewCampaignForm battlefieldId={id} />
    </PageWrapper>
  );
}
