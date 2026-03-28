import Link from 'next/link';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { PageHeader } from '@/components/layout/page-header';
import { listCampaigns } from '@/actions/campaign';
import { getDatabase } from '@/lib/db/index';
import { battlefields, phases, missions } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { TacButton } from '@/components/ui/tac-button';
import { TacCard } from '@/components/ui/tac-card';
import { TacBadge } from '@/components/ui/tac-badge';
import type { CampaignStatus } from '@/types';

const ACTIVE_STATUSES = ['draft', 'planning', 'active', 'compromised'];

const statusCardColor: Record<string, 'green' | 'amber' | 'red' | 'blue' | undefined> = {
  accomplished: 'green',
  active: 'amber',
  planning: 'amber',
  compromised: 'red',
  draft: undefined,
  abandoned: undefined,
};

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const allCampaigns = await listCampaigns(id);
  const campaignList = allCampaigns.filter((c) => !c.isTemplate);

  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, id)).get();

  // Gather phase/mission counts per campaign
  const counts = new Map<string, { phaseCount: number; missionCount: number }>();
  for (const c of campaignList) {
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
    counts.set(c.id, { phaseCount: phaseIds.length, missionCount });
  }

  const activeCampaigns = campaignList.filter(c => ACTIVE_STATUSES.includes(c.status ?? ''));
  const previousCampaigns = campaignList.filter(c => !ACTIVE_STATUSES.includes(c.status ?? ''));

  function renderCampaignCard(campaign: typeof campaignList[number]) {
    const c = counts.get(campaign.id) ?? { phaseCount: 0, missionCount: 0 };
    return (
      <Link
        key={campaign.id}
        href={`/battlefields/${id}/campaigns/${campaign.id}`}
        className="block hover:opacity-90 transition-opacity"
      >
        <TacCard
          status={statusCardColor[campaign.status as CampaignStatus]}
          className="h-full flex flex-col gap-3"
        >
          <div className="font-tactical text-sm text-dr-amber truncate">
            {campaign.name}
          </div>
          {campaign.objective && (
            <div className="font-data text-xs text-dr-muted line-clamp-2">
              {campaign.objective}
            </div>
          )}
          <div className="flex items-center justify-between mt-auto pt-2 border-t border-dr-border/50">
            <TacBadge status={campaign.status ?? 'draft'} />
            <div className="flex items-center gap-3 font-tactical text-[10px] text-dr-dim">
              <span>{c.phaseCount} phase{c.phaseCount !== 1 ? 's' : ''}</span>
              <span>{c.missionCount} mission{c.missionCount !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </TacCard>
      </Link>
    );
  }

  return (
    <PageWrapper>
      <PageHeader codename={bf?.codename ?? ''} section="CAMPAIGNS" title="Campaigns">
        <Link href={`/battlefields/${id}/campaigns/new`}>
          <TacButton variant="primary" size="sm">
            + NEW CAMPAIGN
          </TacButton>
        </Link>
      </PageHeader>

      {/* Active Campaigns */}
      {activeCampaigns.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-tactical text-sm text-dr-amber uppercase tracking-wider">
            ACTIVE CAMPAIGNS
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activeCampaigns.map(renderCampaignCard)}
          </div>
        </div>
      )}

      {/* Previous Campaigns */}
      {previousCampaigns.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-tactical text-sm text-dr-amber uppercase tracking-wider">
            PREVIOUS CAMPAIGNS
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {previousCampaigns.map(renderCampaignCard)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {campaignList.length === 0 && (
        <div className="text-center py-16">
          <div className="font-tactical text-sm text-dr-dim">
            No campaigns deployed. Launch your first operation.
          </div>
        </div>
      )}
    </PageWrapper>
  );
}
