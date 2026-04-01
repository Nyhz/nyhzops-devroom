import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { AssetDetailTabs } from '@/components/asset/asset-detail-tabs';
import { AssetStatusToggle } from '@/components/asset/asset-status-toggle';
import { getAvailableSkillsAndMcps } from '@/actions/discovery';

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDatabase();
  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset) notFound();

  const discovery = await getAvailableSkillsAndMcps();

  return (
    <div className="p-6">
      <Link
        href="/assets"
        className="text-dr-muted hover:text-tac-green font-mono text-xs uppercase tracking-wider transition-colors"
      >
        &larr; Back to all assets
      </Link>

      <div className="flex items-center gap-3 mt-3 mb-6">
        <h1 className="font-mono text-lg text-tac-green">
          {asset.codename}
        </h1>
        {asset.isSystem ? (
          <span className="text-xs px-2 py-0.5 bg-tac-amber/20 text-tac-amber border border-tac-amber/30 rounded font-mono uppercase">System</span>
        ) : null}
        {!asset.isSystem && (
          <AssetStatusToggle assetId={asset.id} status={asset.status ?? 'active'} />
        )}
      </div>
      <AssetDetailTabs asset={asset} discovery={discovery} />
    </div>
  );
}
