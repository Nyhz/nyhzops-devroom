'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { TacCard } from '@/components/ui/tac-card';
import { TacBadge } from '@/components/ui/tac-badge';
import { TacButton } from '@/components/ui/tac-button';
import {
  TacModal,
  TacModalContent,
  TacModalFooter,
  TacModalHeader,
  TacModalTitle,
} from '@/components/ui/modal';
import { AssetForm } from '@/components/asset/asset-form';
import { toggleAssetStatus, deleteAsset } from '@/actions/asset';
import { cn } from '@/lib/utils';
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
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleEdit(asset: Asset) {
    setEditingAsset(asset);
    setShowForm(true);
  }

  function handleCreate() {
    setEditingAsset(undefined);
    setShowForm(true);
  }

  function handleCloseForm() {
    setShowForm(false);
    setEditingAsset(undefined);
  }

  function handleToggle(id: string) {
    startTransition(async () => {
      try {
        await toggleAssetStatus(id);
        toast.success('Asset status changed');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to toggle asset');
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteAsset(id);
        setConfirmDeleteId(null);
        toast.success('Asset removed');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete asset');
      }
    });
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
          {title ?? 'ASSETS // AGENT ROSTER'}
        </div>
        <TacButton variant="success" size="sm" onClick={handleCreate} className="w-full sm:w-auto min-h-[44px] sm:min-h-0">
          + RECRUIT ASSET
        </TacButton>
      </div>

      {/* Create/Edit Modal */}
      <TacModal open={showForm} onOpenChange={(open) => { if (!open) handleCloseForm(); }}>
        <TacModalContent>
          <TacModalHeader>
            <TacModalTitle>
              {editingAsset ? 'MODIFY ASSET' : 'RECRUIT NEW ASSET'}
            </TacModalTitle>
          </TacModalHeader>
          <AssetForm editAsset={editingAsset} onClose={handleCloseForm} />
        </TacModalContent>
      </TacModal>

      {/* Delete Confirmation Modal */}
      <TacModal open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <TacModalContent>
          <TacModalHeader>
            <TacModalTitle>CONFIRM DECOMMISSION</TacModalTitle>
          </TacModalHeader>
          <div className="px-5 pb-5">
            <p className="text-dr-muted font-data text-xs">
              Commander, confirm decommission of this asset? Assets with mission history will be set to OFFLINE instead of deleted.
            </p>
          </div>
          <TacModalFooter>
            <TacButton
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDeleteId(null)}
              disabled={isPending}
            >
              CANCEL
            </TacButton>
            <TacButton
              variant="danger"
              size="sm"
              onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
              disabled={isPending}
            >
              {isPending ? 'PROCESSING...' : 'DECOMMISSION'}
            </TacButton>
          </TacModalFooter>
        </TacModalContent>
      </TacModal>

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
              <TacCard
                key={asset.id}
                status={asset.status === 'active' ? 'green' : undefined}
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <Link
                    href={`/assets/${asset.id}`}
                    className="text-dr-amber font-tactical text-sm tracking-wider uppercase truncate min-w-0 hover:text-tac-amber transition-colors"
                  >
                    {asset.codename}
                  </Link>
                  <div className="flex items-center gap-1 shrink-0">
                    {showSystemBadge && isSystem && (
                      <span className="text-xs px-2 py-0.5 bg-tac-amber/20 text-tac-amber border border-tac-amber/30 rounded font-mono uppercase">
                        SYSTEM
                      </span>
                    )}
                    <button
                      onClick={() => !isSystem && handleToggle(asset.id)}
                      disabled={isPending || isSystem}
                      className={cn(
                        'min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center',
                        isSystem ? 'cursor-not-allowed opacity-60' : 'cursor-pointer disabled:cursor-not-allowed',
                      )}
                      title={isSystem ? 'System assets cannot be toggled' : `Toggle status (currently ${asset.status})`}
                    >
                      <TacBadge status={asset.status ?? 'active'} />
                    </button>
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
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-dr-muted font-tactical text-xs uppercase tracking-wider">
                      Active skills
                    </span>
                    <span className="text-dr-text font-tactical text-xs">
                      {skillCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <TacButton
                      variant="primary"
                      size="sm"
                      onClick={() => handleEdit(asset)}
                      className="text-xs px-2 py-0.5 min-h-[44px] sm:min-h-0"
                    >
                      EDIT
                    </TacButton>
                    <TacButton
                      variant="danger"
                      size="sm"
                      onClick={() => !isSystem && setConfirmDeleteId(asset.id)}
                      disabled={isSystem}
                      className={cn(
                        'text-xs px-2 py-0.5 min-h-[44px] sm:min-h-0',
                        isSystem && 'opacity-40 cursor-not-allowed',
                      )}
                      title={isSystem ? 'System assets cannot be deleted' : undefined}
                    >
                      DELETE
                    </TacButton>
                  </div>
                </div>
              </TacCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
