import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { TacCard } from '@/components/ui/tac-card';
import { TacBadge } from '@/components/ui/tac-badge';
import type { Asset } from '@/types';

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  const db = getDatabase();
  const allAssets = db.select().from(assets).all() as Asset[];

  return (
    <div className="p-6">
      <div className="text-dr-amber font-tactical text-xs tracking-widest uppercase mb-6">
        ASSETS // AGENT ROSTER
      </div>
      {allAssets.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-dr-dim font-tactical text-xs">
            No assets registered. Run the seed script to deploy agents.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {allAssets.map((asset) => (
            <TacCard
              key={asset.id}
              status={asset.status === 'active' ? 'green' : undefined}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="text-dr-amber font-tactical text-sm tracking-wider uppercase">
                  {asset.codename}
                </div>
                <TacBadge status={asset.status ?? 'active'} />
              </div>
              <div className="text-dr-text font-tactical text-xs mb-1">
                {asset.specialty}
              </div>
              <div className="text-dr-dim font-tactical text-[10px] mb-2">
                {asset.model}
              </div>
              <div className="border-t border-dr-border pt-2 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-dr-dim font-tactical text-[10px] uppercase tracking-wider">
                    Missions completed
                  </span>
                  <span className="text-dr-text font-tactical text-xs">
                    {asset.missionsCompleted ?? 0}
                  </span>
                </div>
              </div>
            </TacCard>
          ))}
        </div>
      )}
    </div>
  );
}
