'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TacCard } from '@/components/ui/tac-card';
import { TacBadge } from '@/components/ui/tac-badge';
import { TacButton } from '@/components/ui/tac-button';
import {
  TacModal,
  TacModalContent,
  TacModalHeader,
  TacModalTitle,
} from '@/components/ui/modal';
import { AssetForm } from '@/components/asset/asset-form';
import { toggleAssetStatus, deleteAsset } from '@/actions/asset';
import type { Asset } from '@/types';

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus',
  'claude-sonnet-4-6': 'Sonnet',
  'claude-haiku-4-5-20251001': 'Haiku',
};

interface AssetListProps {
  assets: Asset[];
}

export function AssetList({ assets }: AssetListProps) {
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
      await toggleAssetStatus(id);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteAsset(id);
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
          ASSETS // AGENT ROSTER
        </div>
        <TacButton variant="success" size="sm" onClick={handleCreate}>
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
          <div className="py-4">
            <p className="text-dr-text font-tactical text-sm">
              Commander, confirm decommission of this asset? Assets with mission history will be set to OFFLINE instead of deleted.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <TacButton
              variant="danger"
              size="sm"
              onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
              disabled={isPending}
            >
              {isPending ? 'PROCESSING...' : 'DECOMMISSION'}
            </TacButton>
            <TacButton
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDeleteId(null)}
              disabled={isPending}
            >
              CANCEL
            </TacButton>
          </div>
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
          {assets.map((asset) => (
            <TacCard
              key={asset.id}
              status={asset.status === 'active' ? 'green' : undefined}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="text-dr-amber font-tactical text-sm tracking-wider uppercase">
                  {asset.codename}
                </div>
                <button
                  onClick={() => handleToggle(asset.id)}
                  disabled={isPending}
                  className="cursor-pointer disabled:cursor-not-allowed"
                  title={`Toggle status (currently ${asset.status})`}
                >
                  <TacBadge status={asset.status ?? 'active'} />
                </button>
              </div>
              <div className="text-dr-text font-tactical text-xs mb-1">
                {asset.specialty}
              </div>
              <div className="text-dr-dim font-tactical text-[10px] mb-2">
                {MODEL_LABELS[asset.model ?? 'claude-sonnet-4-6'] ?? asset.model}
              </div>
              <div className="border-t border-dr-border pt-2 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-dr-dim font-tactical text-[10px] uppercase tracking-wider">
                    Missions completed
                  </span>
                  <span className="text-dr-text font-tactical text-xs">
                    {asset.missionsCompleted ?? 0}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <TacButton
                    variant="primary"
                    size="sm"
                    onClick={() => handleEdit(asset)}
                    className="text-[10px] px-2 py-0.5"
                  >
                    EDIT
                  </TacButton>
                  <TacButton
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmDeleteId(asset.id)}
                    className="text-[10px] px-2 py-0.5"
                  >
                    DELETE
                  </TacButton>
                </div>
              </div>
            </TacCard>
          ))}
        </div>
      )}
    </div>
  );
}
