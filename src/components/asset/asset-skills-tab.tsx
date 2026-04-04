'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { SkillToggleList } from '@/components/asset/skill-toggle-list';
import { updateAsset } from '@/actions/asset';
import { refreshDiscoveryCache } from '@/actions/discovery';
import type { Asset, DiscoveredSkill, DiscoveredMcp } from '@/types';

function parseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

interface AssetSkillsTabProps {
  asset: Asset;
  discovery: {
    skills: DiscoveredSkill[];
    mcpServers: DiscoveredMcp[];
  };
}

export function AssetSkillsTab({ asset, discovery }: AssetSkillsTabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enabledSkills, setEnabledSkills] = useState<string[]>(
    parseJsonArray(asset.skills),
  );
  const [enabledMcps, setEnabledMcps] = useState<string[]>(
    parseJsonArray(asset.mcpServers),
  );
  const [skills, setSkills] = useState(discovery.skills);
  const [mcpServers, setMcpServers] = useState(discovery.mcpServers);
  const [lastScanned, setLastScanned] = useState(() => Date.now());

  function handleSkillToggle(id: string, enabled: boolean) {
    const next = enabled
      ? [...enabledSkills, id]
      : enabledSkills.filter((s) => s !== id);
    setEnabledSkills(next);
    persistSkills(next, enabledMcps);
  }

  function handleMcpToggle(id: string, enabled: boolean) {
    const next = enabled
      ? [...enabledMcps, id]
      : enabledMcps.filter((s) => s !== id);
    setEnabledMcps(next);
    persistSkills(enabledSkills, next);
  }

  function persistSkills(nextSkills: string[], nextMcps: string[]) {
    startTransition(async () => {
      try {
        await updateAsset(asset.id, {
          skills: JSON.stringify(nextSkills),
          mcpServers: JSON.stringify(nextMcps),
        });
        toast.success('Asset configuration updated');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update');
      }
    });
  }

  function handleRefresh() {
    startTransition(async () => {
      try {
        const fresh = await refreshDiscoveryCache();
        setSkills(fresh.skills);
        setMcpServers(fresh.mcpServers);
        setLastScanned(Date.now());
        toast.success('Discovery cache refreshed');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to refresh');
      }
    });
  }

  const skillItems = skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    source: s.pluginName,
    enabled: enabledSkills.includes(s.id),
  }));

  const mcpItems = mcpServers.map((m) => ({
    id: m.id,
    name: m.name,
    description: `${m.command} ${m.args.join(' ')}`,
    source: m.source,
    enabled: enabledMcps.includes(m.id),
  }));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <span className="text-dr-muted font-tactical text-xs tracking-wider">
          Last scanned: {timeAgo(lastScanned)}
        </span>
        <TacButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isPending}
        >
          {isPending ? 'SCANNING...' : 'REFRESH'}
        </TacButton>
      </div>

      <div>
        <h2 className="font-tactical text-xs text-dr-amber uppercase tracking-widest mb-3">
          Skills
        </h2>
        <SkillToggleList
          items={skillItems}
          onToggle={handleSkillToggle}
          emptyMessage="No skills discovered on this host."
        />
      </div>

      <div>
        <h2 className="font-tactical text-xs text-dr-amber uppercase tracking-widest mb-3">
          MCP Servers
        </h2>
        <SkillToggleList
          items={mcpItems}
          onToggle={handleMcpToggle}
          emptyMessage="No MCP servers discovered on this host."
        />
      </div>
    </div>
  );
}
