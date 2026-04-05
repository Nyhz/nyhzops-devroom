import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { assets, battlefields, missions, phases } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getCampaign } from '@/actions/campaign';
import { getBriefingMessages } from '@/actions/briefing';
import { getSuggestions } from '@/actions/follow-up';
import { getAvailableSkillsAndMcps } from '@/actions/discovery';
import { TacBadge } from '@/components/ui/tac-badge';
import { BriefingChat } from '@/components/campaign/briefing-chat';
import { CampaignControls } from '@/components/campaign/campaign-controls';
import { CampaignResults } from '@/components/campaign/campaign-results';
import { PlanEditor } from '@/components/campaign/plan-editor';
import { PhaseTimeline } from '@/components/campaign/phase-timeline';
import { CampaignLiveView } from '@/components/campaign/campaign-live-view';
import { CampaignMissionCard } from '@/components/campaign/mission-card';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { PageHeader } from '@/components/layout/page-header';
import type { PlanJSON, MissionPriority, SkillOverrides } from '@/types';

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
      <div className="flex flex-col h-full p-4 md:p-8 gap-4 md:gap-6">
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
          priority: (m.priority || 'routine') as MissionPriority,
          type: (m.type === 'verification' ? 'verification' : 'direct_action') as 'direct_action' | 'verification',
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

    // Load discovery data for skill override panel
    const discovery = await getAvailableSkillsAndMcps();

    // Build asset skills/mcp lookup (codename → asset details)
    const allAssets = db
      .select({
        id: assets.id,
        codename: assets.codename,
        skills: assets.skills,
        mcpServers: assets.mcpServers,
      })
      .from(assets)
      .all();
    const assetByCodename = new Map(allAssets.map((a) => [a.codename, a]));

    // Enrich campaign phases with per-mission asset skills and parsed overrides
    const planningPhases = campaign.phases.map((phase) => ({
      id: phase.id,
      phaseNumber: phase.phaseNumber,
      name: phase.name,
      missions: phase.missions.map((m) => {
        const assetInfo = m.assetCodename ? assetByCodename.get(m.assetCodename) : null;
        let parsedOverrides: SkillOverrides | null = null;
        if (m.skillOverrides) {
          try {
            parsedOverrides = JSON.parse(m.skillOverrides) as SkillOverrides;
          } catch {
            parsedOverrides = null;
          }
        }
        return {
          id: m.id,
          title: m.title,
          assetCodename: m.assetCodename,
          priority: m.priority,
          assetSkills: assetInfo?.skills ?? null,
          assetMcpServers: assetInfo?.mcpServers ?? null,
          skillOverrides: parsedOverrides,
        };
      }),
    }));
    const hasMissions = planningPhases.some((p) => p.missions.length > 0);

    return (
      <PageWrapper breadcrumb={breadcrumb} title={campaign.name}>
        <PlanEditor
          campaignId={campaignId}
          initialPlan={planJSON}
          assets={activeAssets}
        />

        {/* Skill Override Section — shown when DB missions exist */}
        {hasMissions && (
          <div className="mt-4">
            <h3 className="font-tactical text-xs text-dr-amber uppercase tracking-wider mb-3">
              MISSION SKILL OVERRIDES
            </h3>
            <p className="font-data text-xs text-dr-dim mb-4">
              Click an asset name to configure per-mission skill and MCP overrides.
            </p>
            {planningPhases.map((phase) => (
              <div key={phase.id} className="mb-4">
                <div className="font-tactical text-xs text-dr-muted uppercase tracking-wider mb-2">
                  PHASE {phase.phaseNumber} — {phase.name}
                </div>
                <div className="flex flex-col md:flex-row md:flex-wrap gap-3">
                  {phase.missions.map((m) => (
                    <CampaignMissionCard
                      key={m.id}
                      missionId={m.id}
                      title={m.title ?? 'Untitled'}
                      assetCodename={m.assetCodename}
                      status={null}
                      priority={m.priority}
                      durationMs={null}
                      costInput={null}
                      costOutput={null}
                      campaignStatus={status}
                      assetSkills={m.assetSkills}
                      assetMcpServers={m.assetMcpServers}
                      currentSkillOverrides={m.skillOverrides}
                      discoveredSkills={discovery.skills.map((s) => ({
                        id: s.id,
                        name: s.name,
                        description: s.description,
                        pluginName: s.pluginName,
                      }))}
                      discoveredMcps={discovery.mcpServers.map((mc) => ({
                        id: mc.id,
                        name: mc.name,
                        source: mc.source,
                      }))}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

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
          stallReason={campaign.stallReason}
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

    const campaignSuggestions = await getSuggestions({ campaignId });

    return (
      <PageWrapper breadcrumb={breadcrumb} title={campaign.name} actions={statusBadge}>
        <CampaignResults
          missions={resultMissions}
          battlefieldId={id}
          campaignDebrief={campaign.debrief}
          suggestions={campaignSuggestions}
        />
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
