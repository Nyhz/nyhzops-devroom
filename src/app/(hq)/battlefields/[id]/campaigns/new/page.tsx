import { NewCampaignForm } from './form';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function NewCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <PageWrapper maxWidth className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <div className="font-tactical text-xs text-dr-dim uppercase tracking-wider">
        CAMPAIGNS // NEW
      </div>

      {/* Title */}
      <h1 className="font-tactical text-lg text-dr-amber uppercase tracking-wider">
        NEW CAMPAIGN
      </h1>

      {/* Form */}
      <NewCampaignForm battlefieldId={id} />
    </PageWrapper>
  );
}
