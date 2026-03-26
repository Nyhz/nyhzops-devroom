import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getCampaign } from '@/actions/campaign';
import { TacBadge } from '@/components/ui/tac-badge';
import { GeneratePlanButton } from '@/components/campaign/generate-plan-button';
import { CampaignControls } from '@/components/campaign/campaign-controls';
import { PlanEditor } from '@/components/campaign/plan-editor';
import { PhaseTimeline } from '@/components/campaign/phase-timeline';
import type { PlanJSON, MissionPriority } from '@/types';

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;

  const campaign = await getCampaign(campaignId);
  if (!campaign) return notFound();

  const status = campaign.status ?? 'draft';

  // Header — shared across all statuses
  const header = (
    <div className="flex flex-col gap-2">
      <div className="font-tactical text-xs text-dr-dim uppercase tracking-wider">
        CAMPAIGNS // {campaign.name}
      </div>
      <div className="flex items-center gap-4">
        <h1 className="font-tactical text-lg text-dr-amber uppercase tracking-wider">
          {campaign.name}
        </h1>
        <TacBadge status={status} />
      </div>
      {campaign.objective && (
        <p className="font-data text-sm text-dr-muted max-w-3xl">
          {campaign.objective}
        </p>
      )}
    </div>
  );

  // --- DRAFT ---
  if (status === 'draft') {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <GeneratePlanButton campaignId={campaignId} />
        <CampaignControls
          campaignId={campaignId}
          battlefieldId={id}
          status={status}
        />
      </div>
    );
  }

  // --- PLANNING ---
  if (status === 'planning') {
    // Convert DB phases/missions into PlanJSON for the editor
    const planJSON: PlanJSON = {
      summary: campaign.objective || '',
      phases: campaign.phases.map((p) => ({
        name: p.name,
        objective: p.objective || '',
        missions: p.missions.map((m) => ({
          title: m.title || '',
          briefing: m.briefing || '',
          assetCodename: m.assetCodename || '',
          priority: (m.priority || 'normal') as MissionPriority,
          dependsOn: [],
        })),
      })),
    };

    // Get active assets for the plan editor
    const db = getDatabase();
    const activeAssets = db
      .select({
        id: assets.id,
        codename: assets.codename,
        specialty: assets.specialty,
      })
      .from(assets)
      .where(eq(assets.status, 'active'))
      .all();

    return (
      <div className="flex flex-col gap-6">
        {header}
        <PlanEditor
          campaignId={campaignId}
          battlefieldId={id}
          initialPlan={planJSON}
          assets={activeAssets}
        />
        <CampaignControls
          campaignId={campaignId}
          battlefieldId={id}
          status={status}
        />
      </div>
    );
  }

  // --- ACTIVE / PAUSED / ACCOMPLISHED / COMPROMISED ---
  return (
    <div className="flex flex-col gap-6">
      {header}
      <PhaseTimeline phases={campaign.phases} />
      <CampaignControls
        campaignId={campaignId}
        battlefieldId={id}
        status={status}
      />
    </div>
  );
}
