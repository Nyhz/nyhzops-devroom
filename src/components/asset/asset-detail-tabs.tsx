'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AssetProfileTab } from '@/components/asset/asset-profile-tab';
import { AssetPromptTab } from '@/components/asset/asset-prompt-tab';
import { AssetSkillsTab } from '@/components/asset/asset-skills-tab';
import { AssetMemoryTab } from '@/components/asset/asset-memory-tab';
import type { Asset, DiscoveredSkill, DiscoveredMcp } from '@/types';

const TABS = ['PROFILE', 'SYSTEM PROMPT', 'SKILLS & MCPs', 'MEMORY'] as const;
type Tab = (typeof TABS)[number];

interface AssetDetailTabsProps {
  asset: Asset;
  discovery: {
    skills: DiscoveredSkill[];
    mcpServers: DiscoveredMcp[];
  };
}

export function AssetDetailTabs({ asset, discovery }: AssetDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>('PROFILE');

  return (
    <div>
      <div className="flex gap-0 border-b border-dr-border mb-6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'font-tactical text-xs uppercase tracking-widest px-4 py-2 transition-colors',
              'min-h-[44px] md:min-h-0',
              activeTab === tab
                ? 'text-dr-amber border-b-2 border-dr-amber'
                : 'text-dr-muted hover:text-dr-text',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'PROFILE' && <AssetProfileTab asset={asset} />}
      {activeTab === 'SYSTEM PROMPT' && <AssetPromptTab asset={asset} />}
      {activeTab === 'SKILLS & MCPs' && (
        <AssetSkillsTab asset={asset} discovery={discovery} />
      )}
      {activeTab === 'MEMORY' && <AssetMemoryTab asset={asset} />}
    </div>
  );
}
