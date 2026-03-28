import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { AssetList } from '@/components/asset/asset-list';
import { PageWrapper } from '@/components/layout/page-wrapper';
import type { Asset } from '@/types';

export default async function AssetsPage() {
  const db = getDatabase();
  const allAssets = db.select().from(assets).all() as Asset[];

  return (
    <PageWrapper
      breadcrumb={['NYHZ OPS', 'ASSETS']}
      title="AGENT ROSTER"
    >
      <AssetList assets={allAssets} />
    </PageWrapper>
  );
}
