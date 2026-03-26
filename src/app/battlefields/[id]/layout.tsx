import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { battlefields, assets, missions } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import type { Battlefield, Asset } from '@/types';

export default async function BattlefieldLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get() as Battlefield | undefined;

  if (!battlefield) {
    notFound();
  }

  const allAssets = db.select().from(assets).all() as Asset[];

  // Per-asset mission counts for this battlefield
  const assetBreakdown: { codename: string; count: number }[] = [];
  for (const asset of allAssets) {
    const result = db
      .select({ value: count() })
      .from(missions)
      .where(eq(missions.assetId, asset.id))
      .all();
    const missionCount = result[0]?.value ?? 0;
    assetBreakdown.push({ codename: asset.codename, count: missionCount });
  }
  assetBreakdown.sort((a, b) => b.count - a.count);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>

      {/* Right sidebar — assets */}
      <aside className="w-48 border-l border-dr-border bg-dr-surface flex flex-col overflow-y-auto shrink-0">
        {/* Assets header */}
        <div className="px-3 pt-4 pb-2 flex items-center justify-between">
          <span className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
            ASSETS
          </span>
          <Link
            href={`/battlefields/${id}/assets`}
            className="text-dr-dim font-tactical text-[10px] hover:text-dr-muted transition-colors"
          >
            manage
          </Link>
        </div>

        {/* Asset list */}
        <div className="px-3 space-y-1.5 pb-3">
          {allAssets.map((asset) => (
            <div key={asset.id} className="flex items-center gap-2">
              <span
                className={`text-[8px] ${
                  asset.status === 'active' ? 'text-dr-green' : 'text-dr-dim'
                }`}
              >
                ●
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-dr-text font-tactical text-xs truncate">
                  {asset.codename}
                </div>
                <div className="text-dr-dim font-tactical text-[10px] truncate">
                  {asset.model}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Separator */}
        <div className="border-t border-dr-border" />

        {/* Asset breakdown */}
        <div className="px-3 pt-3 pb-4">
          <div className="text-dr-amber font-tactical text-[10px] tracking-widest uppercase mb-2">
            ASSET BREAKDOWN
          </div>
          <div className="space-y-1">
            {assetBreakdown.map((item) => (
              <div key={item.codename} className="flex items-center justify-between">
                <span className="text-dr-muted font-tactical text-xs">
                  {item.codename}
                </span>
                <span className="text-dr-text font-tactical text-xs">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
