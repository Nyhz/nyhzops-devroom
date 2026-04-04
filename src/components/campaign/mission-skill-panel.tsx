'use client';

import { useState, useTransition } from 'react';
import { SkillToggleList } from '@/components/asset/skill-toggle-list';
import { updateMissionSkillOverrides } from '@/actions/campaign-overrides';
import {
  TacModal,
  TacModalContent,
  TacModalHeader,
  TacModalTitle,
} from '@/components/ui/modal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MissionSkillPanelProps {
  missionId: string;
  asset: { skills: string | null; mcpServers: string | null; codename: string };
  currentOverrides: { added?: string[]; removed?: string[] } | null;
  discoveredSkills: Array<{ id: string; name: string; description: string; pluginName: string }>;
  discoveredMcps: Array<{ id: string; name: string; source: string }>;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// MissionSkillPanel
// ---------------------------------------------------------------------------

export function MissionSkillPanel({
  missionId,
  asset,
  currentOverrides,
  discoveredSkills,
  discoveredMcps,
  onClose,
}: MissionSkillPanelProps) {
  const [overrides, setOverrides] = useState<{ added: string[]; removed: string[] }>(() => ({
    added: currentOverrides?.added ?? [],
    removed: currentOverrides?.removed ?? [],
  }));
  const [, startTransition] = useTransition();

  const defaultSkills = parseJsonArray(asset.skills);
  const defaultMcps = parseJsonArray(asset.mcpServers);

  // Compute effective enabled set from defaults + overrides
  const enabledSkills = new Set([
    ...defaultSkills.filter((id) => !overrides.removed.includes(id)),
    ...overrides.added.filter((id) => discoveredSkills.some((s) => s.id === id)),
  ]);

  const enabledMcps = new Set([
    ...defaultMcps.filter((id) => !overrides.removed.includes(id)),
    ...overrides.added.filter((id) => discoveredMcps.some((m) => m.id === id)),
  ]);

  function persistOverrides(next: { added: string[]; removed: string[] }) {
    const hasContent = next.added.length > 0 || next.removed.length > 0;
    const payload = hasContent ? next : null;
    startTransition(() => {
      updateMissionSkillOverrides(missionId, payload).catch(console.error);
    });
  }

  function handleSkillToggle(id: string, enabled: boolean) {
    const isDefault = defaultSkills.includes(id);
    setOverrides((prev) => {
      let { added, removed } = prev;
      if (enabled) {
        if (isDefault) {
          // Toggling ON a default skill that was removed → un-remove it
          removed = removed.filter((r) => r !== id);
        } else {
          // Toggling ON a non-default skill → add it
          if (!added.includes(id)) added = [...added, id];
        }
      } else {
        if (isDefault) {
          // Toggling OFF a default skill → mark removed
          if (!removed.includes(id)) removed = [...removed, id];
        } else {
          // Toggling OFF a non-default that was added → un-add it
          added = added.filter((a) => a !== id);
        }
      }
      const next = { added, removed };
      persistOverrides(next);
      return next;
    });
  }

  function handleMcpToggle(id: string, enabled: boolean) {
    const isDefault = defaultMcps.includes(id);
    setOverrides((prev) => {
      let { added, removed } = prev;
      if (enabled) {
        if (isDefault) {
          removed = removed.filter((r) => r !== id);
        } else {
          if (!added.includes(id)) added = [...added, id];
        }
      } else {
        if (isDefault) {
          if (!removed.includes(id)) removed = [...removed, id];
        } else {
          added = added.filter((a) => a !== id);
        }
      }
      const next = { added, removed };
      persistOverrides(next);
      return next;
    });
  }

  const skillItems = discoveredSkills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    source: s.pluginName,
    enabled: enabledSkills.has(s.id),
  }));

  const mcpItems = discoveredMcps.map((m) => ({
    id: m.id,
    name: m.name,
    description: '',
    source: m.source,
    enabled: enabledMcps.has(m.id),
  }));

  const hasOverrides = overrides.added.length > 0 || overrides.removed.length > 0;

  return (
    <TacModal open onOpenChange={(open) => { if (!open) onClose(); }}>
      <TacModalContent>
        {/* Header */}
        <TacModalHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <TacModalTitle>SKILL OVERRIDE</TacModalTitle>
              <span className="font-mono text-xs text-dr-muted truncate">
                {asset.codename}
              </span>
            </div>
            {hasOverrides && (
              <span className="font-tactical text-xs text-dr-amber animate-pulse shrink-0">
                MODIFIED
              </span>
            )}
          </div>
        </TacModalHeader>

        {/* Skills section */}
        <div className="px-5 pt-4 pb-2">
          <span className="font-tactical text-xs text-dr-muted uppercase tracking-wider block mb-2">
            SKILLS
          </span>
          <SkillToggleList
            items={skillItems}
            onToggle={handleSkillToggle}
            emptyMessage="No skills discovered."
          />
        </div>

        {/* MCP section */}
        <div className="px-5 pt-2 pb-5">
          <span className="font-tactical text-xs text-dr-muted uppercase tracking-wider block mb-2">
            MCP SERVERS
          </span>
          <SkillToggleList
            items={mcpItems}
            onToggle={handleMcpToggle}
            emptyMessage="No MCP servers discovered."
          />
        </div>
      </TacModalContent>
    </TacModal>
  );
}
