import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { AssetList } from '@/components/asset/asset-list';
import { PageWrapper } from '@/components/layout/page-wrapper';
import type { Asset } from '@/types';

export default async function AssetsPage() {
  const db = getDatabase();
  const allAssets = db.select().from(assets).all() as Asset[];
  const missionAssets = allAssets.filter(a => !a.isSystem);
  const systemAssets = allAssets.filter(a => a.isSystem);

  return (
    <PageWrapper
      breadcrumb={['NYHZ OPS', 'ASSETS']}
      title="AGENT ROSTER"
    >
      <div className="space-y-8">
        <AssetList title="MISSION ASSETS" assets={missionAssets} showSystemBadge={false} />
        <AssetList title="SYSTEM ASSETS" assets={systemAssets} showSystemBadge={true} />
      </div>
    </PageWrapper>
  );
}
