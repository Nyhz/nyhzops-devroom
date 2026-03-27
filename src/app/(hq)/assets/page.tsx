import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { AssetList } from '@/components/asset/asset-list';
import { PageWrapper } from '@/components/layout/page-wrapper';
import type { Asset } from '@/types';

export default async function AssetsPage() {
  const db = getDatabase();
  const allAssets = db.select().from(assets).all() as Asset[];

  return (
    <PageWrapper>
      <div>
        <div className="text-dr-dim font-tactical text-xs tracking-wider uppercase mb-1">
          NYHZ OPS // ASSETS
        </div>
        <h1 className="text-dr-amber font-tactical text-lg tracking-wider uppercase">
          Agent Roster
        </h1>
      </div>
      <AssetList assets={allAssets} />
    </PageWrapper>
  );
}
