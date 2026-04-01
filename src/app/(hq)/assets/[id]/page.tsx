import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { AssetDetailTabs } from '@/components/asset/asset-detail-tabs';
import { getAvailableSkillsAndMcps } from '@/actions/discovery';

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDatabase();
  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset) notFound();

  const discovery = await getAvailableSkillsAndMcps();

  return (
    <div className="p-6">
      <h1 className="font-mono text-lg text-tac-green mb-6">
        {asset.codename}
        {asset.isSystem ? (
          <span className="ml-2 text-xs px-2 py-0.5 bg-tac-amber/20 text-tac-amber border border-tac-amber/30 rounded font-mono uppercase">System</span>
        ) : null}
      </h1>
      <AssetDetailTabs asset={asset} discovery={discovery} />
    </div>
  );
}
