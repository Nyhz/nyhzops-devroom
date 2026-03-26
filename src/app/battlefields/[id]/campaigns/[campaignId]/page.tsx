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
import { CampaignLiveView } from '@/components/campaign/campaign-live-view';
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
  const isTemplate = Boolean(campaign.isTemplate);

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
        {isTemplate && (
          <span className="font-tactical text-[10px] text-dr-blue border border-dr-blue/40 px-2 py-0.5 uppercase tracking-wider">
            TEMPLATE
          </span>
        )}
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
          isTemplate={isTemplate}
        />
      </div>
    );
  }

  // --- PLANNING ---
  if (status === 'planning') {
    // Templates in planning: show read-only phase timeline + RUN TEMPLATE button
    if (isTemplate) {
      return (
        <div className="flex flex-col gap-6">
          {header}
          <PhaseTimeline phases={campaign.phases} />
          <CampaignControls
            campaignId={campaignId}
            battlefieldId={id}
            status={status}
            isTemplate={isTemplate}
          />
        </div>
      );
    }

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
          isTemplate={isTemplate}
        />
      </div>
    );
  }

  // --- ACTIVE / PAUSED ---
  if (status === 'active' || status === 'paused') {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <CampaignLiveView
          campaignId={campaignId}
          initialStatus={status}
          initialPhases={campaign.phases}
          battlefieldId={id}
        />
        <CampaignControls
          campaignId={campaignId}
          battlefieldId={id}
          status={status}
          isTemplate={isTemplate}
        />
      </div>
    );
  }

  // --- ACCOMPLISHED / COMPROMISED ---
  return (
    <div className="flex flex-col gap-6">
      {header}
      <PhaseTimeline phases={campaign.phases} />
      <CampaignControls
        campaignId={campaignId}
        battlefieldId={id}
        status={status}
        isTemplate={isTemplate}
      />
    </div>
  );
}
