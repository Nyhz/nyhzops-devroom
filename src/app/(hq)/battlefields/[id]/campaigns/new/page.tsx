import { NewCampaignForm } from './form';

export default async function NewCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-8 flex flex-col gap-6 max-w-3xl">
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
    </div>
  );
}
