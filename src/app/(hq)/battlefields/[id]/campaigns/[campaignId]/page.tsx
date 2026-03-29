import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { assets, battlefields, missions, phases } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getCampaign } from '@/actions/campaign';
import { getBriefingMessages } from '@/actions/briefing';
import { TacBadge } from '@/components/ui/tac-badge';
import { BriefingChat } from '@/components/campaign/briefing-chat';
import { CampaignControls } from '@/components/campaign/campaign-controls';
import { CampaignResults } from '@/components/campaign/campaign-results';
import { PlanEditor } from '@/components/campaign/plan-editor';
import { PhaseTimeline } from '@/components/campaign/phase-timeline';
import { CampaignLiveView } from '@/components/campaign/campaign-live-view';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { PageHeader } from '@/components/layout/page-header';
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

  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, id)).get();

  const controls = (
    <CampaignControls
      campaignId={campaignId}
      battlefieldId={id}
      status={status}
    />
  );

  const breadcrumb = [bf?.codename ?? '', 'CAMPAIGNS'];
  const statusBadge = <TacBadge status={status} />;

  // --- DRAFT ---
  if (status === 'draft') {
    const briefingMessages = await getBriefingMessages(campaignId);

    return (
      <div className="flex flex-col h-full p-8 gap-6">
        <PageHeader codename={bf?.codename ?? ''} section="CAMPAIGNS" title={campaign.name} />
        <BriefingChat campaignId={campaignId} initialMessages={briefingMessages} />
        {controls}
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
      <PageWrapper breadcrumb={breadcrumb} title={campaign.name}>
        <PlanEditor
          campaignId={campaignId}
          initialPlan={planJSON}
          assets={activeAssets}
        />
        {controls}
      </PageWrapper>
    );
  }

  // --- ACTIVE ---
  if (status === 'active' || status === 'paused') {
    return (
      <PageWrapper breadcrumb={breadcrumb} title={campaign.name} actions={statusBadge}>
        <CampaignLiveView
          campaignId={campaignId}
          initialStatus={status}
          initialPhases={campaign.phases}
          battlefieldId={id}
        />
        {controls}
      </PageWrapper>
    );
  }

  // --- COMPROMISED ---
  if (status === 'compromised') {
    return (
      <PageWrapper breadcrumb={breadcrumb} title={campaign.name} actions={statusBadge}>
        <CampaignLiveView
          campaignId={campaignId}
          initialStatus={status}
          initialPhases={campaign.phases}
          battlefieldId={id}
        />
        {controls}
      </PageWrapper>
    );
  }

  // --- ACCOMPLISHED ---
  if (status === 'accomplished') {
    const resultMissions = db.select({
      id: missions.id,
      title: missions.title,
      status: missions.status,
      assetCodename: assets.codename,
      costInput: missions.costInput,
      costOutput: missions.costOutput,
      costCacheHit: missions.costCacheHit,
      durationMs: missions.durationMs,
      phaseName: phases.name,
      phaseNumber: phases.phaseNumber,
      phaseDebrief: phases.debrief,
    }).from(missions)
      .innerJoin(phases, eq(missions.phaseId, phases.id))
      .leftJoin(assets, eq(missions.assetId, assets.id))
      .where(eq(missions.campaignId, campaignId))
      .orderBy(phases.phaseNumber, missions.createdAt)
      .all();

    return (
      <PageWrapper breadcrumb={breadcrumb} title={campaign.name} actions={statusBadge}>
        <CampaignResults missions={resultMissions} battlefieldId={id} />
        {controls}
      </PageWrapper>
    );
  }

  // --- ABANDONED (and any other status) ---
  return (
    <PageWrapper breadcrumb={breadcrumb} title={campaign.name} actions={statusBadge}>
      <PhaseTimeline phases={campaign.phases} battlefieldId={id} />
      {controls}
    </PageWrapper>
  );
}
