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

  const modelLabel = {
    'claude-opus-4-6': 'Opus',
    'claude-sonnet-4-6': 'Sonnet',
    'claude-haiku-4-5-20251001': 'Haiku',
  }[asset.model ?? 'claude-sonnet-4-6'] ?? asset.model;

  return (
    <div className="p-6">
      <Link
        href="/assets"
        className="text-dr-muted hover:text-tac-green font-tactical text-xs tracking-widest uppercase transition-colors"
      >
        &larr; Back to all assets
      </Link>

      <div className="bg-dr-surface border border-dr-border border-l-2 border-l-dr-green p-6 mt-3 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-dr-amber font-tactical text-lg tracking-wider uppercase">
                {asset.codename}
              </h1>
              {asset.isSystem ? (
                <span className="text-xs px-2 py-0.5 bg-tac-amber/20 text-tac-amber border border-tac-amber/30 rounded font-tactical uppercase">System</span>
              ) : null}
              {!asset.isSystem && (
                <AssetStatusToggle assetId={asset.id} status={asset.status ?? 'active'} />
              )}
            </div>
            <div className="text-dr-text font-tactical text-xs mt-1">{asset.specialty}</div>
            <div className="text-dr-muted font-tactical text-xs mt-0.5">{modelLabel}</div>
          </div>
          <div className="text-right">
            <div className="text-dr-muted font-tactical text-xs uppercase tracking-wider">Missions</div>
            <div className="text-dr-text font-tactical text-lg">{asset.missionsCompleted ?? 0}</div>
          </div>
        </div>
      </div>

      <AssetDetailTabs asset={asset} discovery={discovery} />
    </div>
  );
}
