import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { listCampaigns, listTemplates, runTemplate } from '@/actions/campaign';
import { getDatabase } from '@/lib/db/index';
import { battlefields, phases, missions } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { TacButton } from '@/components/ui/tac-button';
import { TacCard } from '@/components/ui/tac-card';
import { TacBadge } from '@/components/ui/tac-badge';
import type { CampaignStatus } from '@/types';

const statusCardColor: Record<string, 'green' | 'amber' | 'red' | 'blue' | undefined> = {
  accomplished: 'green',
  active: 'amber',
  planning: 'amber',
  compromised: 'red',
  draft: undefined,
  paused: undefined,
};

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Exclude templates from the main campaign list
  const allCampaigns = await listCampaigns(id);
  const campaignList = allCampaigns.filter((c) => !c.isTemplate);
  const templateList = await listTemplates(id);

  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, id)).get();

  // Gather phase/mission counts per campaign
  const counts = campaignList.map((c) => {
    const campaignPhases = db
      .select({ id: phases.id })
      .from(phases)
      .where(eq(phases.campaignId, c.id))
      .all();
    const phaseIds = campaignPhases.map((p) => p.id);
    let missionCount = 0;
    if (phaseIds.length > 0) {
      missionCount = db
        .select({ id: missions.id })
        .from(missions)
        .where(inArray(missions.phaseId, phaseIds))
        .all().length;
    }
    return { phaseCount: phaseIds.length, missionCount };
  });

  const templateCounts = templateList.map((c) => {
    const templatePhases = db
      .select({ id: phases.id })
      .from(phases)
      .where(eq(phases.campaignId, c.id))
      .all();
    const phaseIds = templatePhases.map((p) => p.id);
    let missionCount = 0;
    if (phaseIds.length > 0) {
      missionCount = db
        .select({ id: missions.id })
        .from(missions)
        .where(inArray(missions.phaseId, phaseIds))
        .all().length;
    }
    return { phaseCount: phaseIds.length, missionCount };
  });

  async function handleRunTemplate(templateId: string) {
    'use server';
    const newCampaign = await runTemplate(templateId);
    redirect(`/battlefields/${id}/campaigns/${newCampaign.id}`);
  }

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'CAMPAIGNS']}
      title="CAMPAIGNS"
      actions={
        <Link href={`/battlefields/${id}/campaigns/new`}>
          <TacButton variant="primary" size="sm">
            + NEW CAMPAIGN
          </TacButton>
        </Link>
      }
    >

      {/* Campaign grid */}
      {campaignList.length === 0 ? (
        <div className="text-center py-16">
          <div className="font-tactical text-sm text-dr-dim">
            No campaigns deployed. Launch your first operation.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {campaignList.map((campaign, i) => (
            <Link
              key={campaign.id}
              href={`/battlefields/${id}/campaigns/${campaign.id}`}
              className="block hover:opacity-90 transition-opacity"
            >
              <TacCard
                status={statusCardColor[campaign.status as CampaignStatus]}
                className="h-full flex flex-col gap-3"
              >
                {/* Name */}
                <div className="font-tactical text-sm text-dr-amber truncate">
                  {campaign.name}
                </div>

                {/* Objective */}
                {campaign.objective && (
                  <div className="font-data text-xs text-dr-muted line-clamp-2">
                    {campaign.objective}
                  </div>
                )}

                {/* Footer: status + counts */}
                <div className="flex items-center justify-between mt-auto pt-2 border-t border-dr-border/50">
                  <TacBadge status={campaign.status ?? 'draft'} />
                  <div className="flex items-center gap-3 font-tactical text-[10px] text-dr-dim">
                    <span>{counts[i].phaseCount} phase{counts[i].phaseCount !== 1 ? 's' : ''}</span>
                    <span>{counts[i].missionCount} mission{counts[i].missionCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </TacCard>
            </Link>
          ))}
        </div>
      )}

      {/* Templates separator */}
      <div className="border-t border-dr-border/50 pt-6">
        <h2 className="font-tactical text-sm text-dr-amber uppercase tracking-wider mb-4">
          TEMPLATES
        </h2>

        {templateList.length === 0 ? (
          <div className="text-center py-8">
            <div className="font-tactical text-xs text-dr-dim">
              No templates saved. Save an accomplished or planning campaign as a template.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {templateList.map((template, i) => (
              <TacCard key={template.id} className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="font-tactical text-sm text-dr-text truncate">
                    {template.name}
                  </div>
                  <div className="flex items-center gap-3 font-tactical text-[10px] text-dr-dim">
                    <span>{templateCounts[i].phaseCount} phase{templateCounts[i].phaseCount !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>{templateCounts[i].missionCount} mission{templateCounts[i].missionCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link href={`/battlefields/${id}/campaigns/${template.id}`}>
                    <TacButton variant="ghost" size="sm">
                      VIEW
                    </TacButton>
                  </Link>
                  <form action={handleRunTemplate.bind(null, template.id)}>
                    <TacButton variant="primary" size="sm" type="submit">
                      RUN TEMPLATE
                    </TacButton>
                  </form>
                </div>
              </TacCard>
            ))}
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
