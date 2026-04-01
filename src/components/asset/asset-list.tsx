import Link from 'next/link';
import { TacCard } from '@/components/ui/tac-card';
import { TacBadge } from '@/components/ui/tac-badge';
import type { Asset } from '@/types';

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus',
  'claude-sonnet-4-6': 'Sonnet',
  'claude-haiku-4-5-20251001': 'Haiku',
};

interface AssetListProps {
  assets: Asset[];
  title?: string;
  showSystemBadge?: boolean;
}

export function AssetList({ assets, title, showSystemBadge = false }: AssetListProps) {
  return (
    <div>
      <div className="mb-6">
        <div className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
          {title ?? 'ASSETS // AGENT ROSTER'}
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-dr-dim font-tactical text-xs">
            No assets registered. Recruit your first agent or run the seed script.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {assets.map((asset) => {
            const isSystem = Boolean(asset.isSystem);
            let skillCount = 0;
            try {
              const parsed = JSON.parse(asset.skills ?? '[]');
              skillCount = Array.isArray(parsed) ? parsed.length : 0;
            } catch {
              skillCount = 0;
            }

            return (
              <Link key={asset.id} href={`/assets/${asset.id}`}>
                <TacCard
                  status={asset.status === 'active' ? 'green' : undefined}
                  className="cursor-pointer transition-all duration-150 hover:border-dr-green/40 hover:bg-dr-surface/80 hover:shadow-[0_0_12px_rgba(0,255,0,0.05)]"
                >
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <span className="text-dr-amber font-tactical text-sm tracking-wider uppercase truncate min-w-0">
                      {asset.codename}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {showSystemBadge && isSystem && (
                        <span className="text-xs px-2 py-0.5 bg-tac-amber/20 text-tac-amber border border-tac-amber/30 rounded font-mono uppercase">
                          SYSTEM
                        </span>
                      )}
                      <TacBadge status={asset.status ?? 'active'} />
                    </div>
                  </div>
                  <div className="text-dr-text font-tactical text-xs mb-1 truncate">
                    {asset.specialty}
                  </div>
                  <div className="text-dr-muted font-tactical text-xs mb-2">
                    {MODEL_LABELS[asset.model ?? 'claude-sonnet-4-6'] ?? asset.model}
                  </div>
                  <div className="border-t border-dr-border pt-2 mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-dr-muted font-tactical text-xs uppercase tracking-wider">
                        Missions completed
                      </span>
                      <span className="text-dr-text font-tactical text-xs">
                        {asset.missionsCompleted ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-dr-muted font-tactical text-xs uppercase tracking-wider">
                        Active skills
                      </span>
                      <span className="text-dr-text font-tactical text-xs">
                        {skillCount}
                      </span>
                    </div>
                  </div>
                </TacCard>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
