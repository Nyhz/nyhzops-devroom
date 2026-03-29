'use client';

import { useState, useRef, useTransition } from 'react';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacTextareaWithImages } from '@/components/ui/tac-textarea-with-images';
import { TacCard } from '@/components/ui/tac-card';
import { DossierSelector } from '@/components/dashboard/dossier-selector';
import { createMission, createAndDeployMission } from '@/actions/mission';
import { linkNoteToMission } from '@/actions/intel';

interface DeployMissionProps {
  battlefieldId: string;
  assets: Array<{ id: string; codename: string; status: string }>;
  className?: string;
  initialBriefing?: string;
  noteId?: string;
}

export function DeployMission({ battlefieldId, assets, className, initialBriefing, noteId }: DeployMissionProps) {
  const [briefing, setBriefing] = useState(initialBriefing ?? '');
  const [assetId, setAssetId] = useState('');
  const [dossierName, setDossierName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeAssets = assets.filter((a) => a.status === 'active');

  const handleDossierApply = (resolvedBriefing: string, assetCodename: string | null) => {
    setBriefing(resolvedBriefing);
    setDossierName(null);
    if (assetCodename) {
      const matched = activeAssets.find(
        (a) => a.codename.toUpperCase() === assetCodename.toUpperCase(),
      );
      if (matched) {
        setAssetId(matched.id);
      }
    }
  };

  const handleDossier = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBriefing(reader.result as string);
      setDossierName(file.name);
      // Clear dossier name after 3s
      setTimeout(() => setDossierName(null), 3000);
    };
    reader.readAsText(file);
    // Reset so the same file can be loaded again
    e.target.value = '';
  };

  const resetForm = () => {
    setBriefing('');
    setAssetId('');
    setDossierName(null);
  };

  const handleSave = () => {
    if (!briefing.trim()) return;
    startTransition(async () => {
      try {
        const mission = await createMission({
          battlefieldId,
          briefing: briefing.trim(),
          assetId: assetId || undefined,
        });
        if (noteId) {
          await linkNoteToMission(noteId, mission.id);
        }
        resetForm();
        toast.success('Mission saved — STANDBY');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create mission');
      }
    });
  };

  const handleSaveAndDeploy = () => {
    if (!briefing.trim()) return;
    startTransition(async () => {
      try {
        const mission = await createAndDeployMission({
          battlefieldId,
          briefing: briefing.trim(),
          assetId: assetId || undefined,
        });
        if (noteId) {
          await linkNoteToMission(noteId, mission.id);
        }
        resetForm();
        toast.success('Mission deployed — QUEUED');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to deploy mission');
      }
    });
  };

  return (
    <TacCard className={className}>
      <div className="text-dr-amber font-tactical text-xs tracking-widest uppercase mb-3">
        DEPLOY MISSION
      </div>

      <div className="space-y-3">
        <TacTextareaWithImages
          placeholder="Describe the mission objective and any relevant intel..."
          rows={3}
          value={briefing}
          onChange={setBriefing}
          disabled={isPending}
        />

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            disabled={isPending}
            className="bg-dr-bg border border-dr-border text-dr-text font-tactical text-sm px-3 py-2 focus:border-dr-amber focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">NO ASSET</option>
            {activeAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.codename}
              </option>
            ))}
          </select>

          <DossierSelector onApply={handleDossierApply} />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending}
            className="text-dr-dim font-tactical text-xs hover:text-dr-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            [Load dossier]
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt"
            onChange={handleDossier}
            className="hidden"
          />

          {dossierName && (
            <span className="text-dr-dim font-tactical text-xs">
              Loaded: {dossierName}
            </span>
          )}

          <div className="flex-1" />

          <TacButton
            variant="success"
            size="sm"
            onClick={handleSave}
            disabled={isPending || !briefing.trim()}
          >
            SAVE
          </TacButton>
          <TacButton
            variant="primary"
            size="sm"
            onClick={handleSaveAndDeploy}
            disabled={isPending || !briefing.trim()}
          >
            SAVE &amp; DEPLOY
          </TacButton>
        </div>
      </div>
    </TacCard>
  );
}
