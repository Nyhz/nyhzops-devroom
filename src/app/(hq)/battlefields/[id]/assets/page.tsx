import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { AssetList } from '@/components/asset/asset-list';
import { PageWrapper } from '@/components/layout/page-wrapper';
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
    <PageWrapper>
      <AssetList assets={allAssets} />
    </PageWrapper>
  );
}
