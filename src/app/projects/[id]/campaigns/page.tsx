import Link from 'next/link';
import { listCampaigns } from '@/actions/campaign';
import { getDatabase } from '@/lib/db/index';
import { phases, missions } from '@/lib/db/schema';
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
  const campaignList = await listCampaigns(id);

  // Gather phase/mission counts per campaign
  const db = getDatabase();
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

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-tactical text-lg text-dr-amber uppercase tracking-wider">
          CAMPAIGNS
        </h1>
        <Link href={`/projects/${id}/campaigns/new`}>
          <TacButton variant="primary" size="sm">
            + NEW CAMPAIGN
          </TacButton>
        </Link>
      </div>

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
              href={`/projects/${id}/campaigns/${campaign.id}`}
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
    </div>
  );
}
