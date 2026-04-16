'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ConfigForm } from '@/components/config/config-form';
import { GateManifestEditor } from '@/components/config/GateManifestEditor';
import { MainRedOverrideToggle } from '@/components/config/MainRedOverrideToggle';
import { ForensicPruneForm } from '@/components/config/ForensicPruneForm';
import type { GateManifest } from '@/control/gates';

const TABS = ['PROFILE', 'GATES', 'MAIN BRANCH', 'FORENSICS'] as const;
type Tab = (typeof TABS)[number];

interface ConfigTabsProps {
  battlefieldId: string;
  profile: {
    name: string;
    codename: string;
    description: string | null;
    initialBriefing: string | null;
    defaultBranch: string | null;
    devServerCommand: string | null;
    autoStartDevServer: number | null;
    repoPath: string;
    claudeMdPath: string | null;
    specMdPath: string | null;
  };
  gateManifest: GateManifest | null;
  needsGateManifest: boolean;
  overrideEnabled: boolean;
}

export function ConfigTabs({
  battlefieldId,
  profile,
  gateManifest,
  needsGateManifest,
  overrideEnabled,
}: ConfigTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>(
    needsGateManifest ? 'GATES' : 'PROFILE',
  );

  return (
    <div>
      <div className="flex gap-0 border-b border-dr-border mb-6 overflow-x-auto">
        {TABS.map((tab) => {
          const showDot = tab === 'GATES' && needsGateManifest;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'font-tactical text-xs uppercase tracking-widest px-4 py-2 transition-colors whitespace-nowrap',
                'min-h-[44px] md:min-h-0 inline-flex items-center gap-2',
                activeTab === tab
                  ? 'text-dr-amber border-b-2 border-dr-amber'
                  : 'text-dr-muted hover:text-dr-text',
              )}
            >
              {tab}
              {showDot && (
                <span
                  aria-label="action required"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-dr-amber"
                />
              )}
            </button>
          );
        })}
      </div>

      {activeTab === 'PROFILE' && (
        <ConfigForm id={battlefieldId} {...profile} />
      )}

      {activeTab === 'GATES' && (
        <div className="space-y-4">
          {needsGateManifest && (
            <div className="border border-dr-amber/50 bg-dr-amber/5 p-4 flex items-start gap-3">
              <span className="text-dr-amber text-xs font-tactical uppercase tracking-wider shrink-0">
                ⚠ Gate Manifest Required
              </span>
              <span className="text-xs font-data text-dr-amber/80">
                Gate manifest not configured — run{' '}
                <span className="font-tactical text-dr-amber">
                  AUTO-DETECT (EstablishGates)
                </span>{' '}
                below or fill in commands manually.
              </span>
            </div>
          )}
          <GateManifestEditor
            battlefieldId={battlefieldId}
            initialManifest={gateManifest}
          />
        </div>
      )}

      {activeTab === 'MAIN BRANCH' && (
        <MainRedOverrideToggle
          battlefieldId={battlefieldId}
          initialEnabled={overrideEnabled}
        />
      )}

      {activeTab === 'FORENSICS' && (
        <ForensicPruneForm battlefieldId={battlefieldId} />
      )}
    </div>
  );
}
