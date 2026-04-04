"use client";

import { useState, useTransition } from 'react';
import { ResponsiveTable, type Column } from '@/components/ui/responsive-table';
import { TacButton } from '@/components/ui/tac-button';
import { cn } from '@/lib/utils';
import { updatePackage, removePackage, getOutdatedDeps } from '@/actions/deps';
import type { DepEntry, OutdatedDep } from '@/types';

interface DepsTableProps {
  battlefieldId: string;
  initialDeps: DepEntry[];
  initialDevDeps: DepEntry[];
  initialOutdated: OutdatedDep[];
  className?: string;
}

function isMajorBehind(current: string, latest: string): boolean {
  const curMajor = current.replace(/^[^\d]*/, '').split('.')[0];
  const latMajor = latest.replace(/^[^\d]*/, '').split('.')[0];
  return curMajor !== latMajor;
}

type DisplayDep = DepEntry & { outdated?: OutdatedDep };

export function DepsTable({
  battlefieldId,
  initialDeps,
  initialDevDeps,
  initialOutdated,
  className,
}: DepsTableProps) {
  const [outdated, setOutdated] = useState<OutdatedDep[]>(initialOutdated);
  const [isPending, startTransition] = useTransition();

  const outdatedMap = new Map(outdated.map((o) => [o.name, o]));

  const allDeps: DisplayDep[] = [
    ...initialDeps.map((d) => ({ ...d, outdated: outdatedMap.get(d.name) })),
    ...initialDevDeps.map((d) => ({ ...d, outdated: outdatedMap.get(d.name) })),
  ];

  function handleUpdate(name?: string) {
    startTransition(async () => {
      await updatePackage(battlefieldId, name);
    });
  }

  function handleRemove(name: string) {
    if (!window.confirm(`Remove ${name}?`)) return;
    startTransition(async () => {
      await removePackage(battlefieldId, name);
    });
  }

  function handleRefresh() {
    startTransition(async () => {
      const result = await getOutdatedDeps(battlefieldId);
      setOutdated(result);
    });
  }

  const columns: Column<DisplayDep>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (dep) => <span className="text-dr-text">{dep.name}</span>,
    },
    {
      key: 'version',
      header: 'Version',
      render: (dep) => <span className="text-dr-muted">{dep.version}</span>,
    },
    {
      key: 'latest',
      header: 'Latest',
      hideOnMobile: true,
      render: (dep) => {
        if (!dep.outdated) return <span className="text-dr-dim">—</span>;
        return (
          <span className={isMajorBehind(dep.outdated.current, dep.outdated.latest) ? 'text-dr-red' : 'text-dr-amber'}>
            {dep.outdated.latest}
          </span>
        );
      },
    },
    {
      key: 'type',
      header: 'Type',
      render: (dep) => (
        <span
          className={cn(
            'text-xs uppercase tracking-wider px-2 py-0.5 border',
            dep.isDev
              ? 'border-dr-amber/40 text-dr-amber'
              : 'border-dr-green/40 text-dr-green',
          )}
        >
          {dep.isDev ? 'DEV' : 'DEP'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      hideOnMobile: true,
      render: (dep) => (
        <div className="flex gap-2">
          {dep.outdated && (
            <TacButton
              size="sm"
              variant="primary"
              onClick={() => handleUpdate(dep.name)}
              disabled={isPending}
            >
              UPDATE
            </TacButton>
          )}
          <TacButton
            size="sm"
            variant="danger"
            onClick={() => handleRemove(dep.name)}
            disabled={isPending}
          >
            REMOVE
          </TacButton>
        </div>
      ),
    },
  ];

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center gap-3">
        {outdated.length > 0 && (
          <TacButton
            size="sm"
            variant="primary"
            onClick={() => handleUpdate()}
            disabled={isPending}
          >
            UPDATE ALL OUTDATED ({outdated.length})
          </TacButton>
        )}
        <TacButton
          size="sm"
          variant="ghost"
          onClick={handleRefresh}
          disabled={isPending}
        >
          {isPending ? 'CHECKING...' : 'REFRESH'}
        </TacButton>
      </div>

      <ResponsiveTable
        columns={columns}
        data={allDeps}
        keyExtractor={(dep) => dep.name}
        emptyMessage="No dependencies found in package.json"
      />
    </div>
  );
}
