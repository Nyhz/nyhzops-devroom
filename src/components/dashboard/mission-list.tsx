'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SearchInput } from '@/components/ui/search-input';
import { TacBadge } from '@/components/ui/tac-badge';
import { formatRelativeTime } from '@/lib/utils';

interface MissionListProps {
  missions: Array<{
    id: string;
    title: string | null;
    status: string | null;
    priority: string | null;
    iterations: number | null;
    assetCodename: string | null;
    createdAt: number;
  }>;
  battlefieldId: string;
}

function getStatusBorderColor(status: string | null): string {
  switch (status) {
    case 'accomplished':
      return 'border-l-dr-green';
    case 'in_combat':
    case 'deploying':
    case 'queued':
      return 'border-l-dr-amber';
    case 'compromised':
      return 'border-l-dr-red';
    case 'standby':
    case 'abandoned':
    default:
      return 'border-l-dr-dim';
  }
}

export function MissionList({ missions, battlefieldId }: MissionListProps) {
  const [search, setSearch] = useState('');

  const filtered = search
    ? missions.filter((m) =>
        (m.title ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : missions;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
          MISSIONS
        </div>
        <SearchInput
          placeholder="Search missions..."
          className="w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-dr-surface border border-dr-border p-8 text-center">
          <div className="text-dr-dim font-tactical text-xs">
            {missions.length === 0
              ? 'No missions deployed yet. Deploy your first mission above.'
              : 'No missions match your search.'}
          </div>
        </div>
      ) : (
        <div className="space-y-px">
          {filtered.map((mission) => (
            <div
              key={mission.id}
              className={`bg-dr-surface border-l-2 ${getStatusBorderColor(mission.status)} flex items-center justify-between px-4 py-3`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-dr-text font-tactical text-sm truncate">
                    {mission.title ?? 'Untitled Mission'}
                  </span>
                  {(mission.iterations ?? 0) > 1 && (
                    <span className="text-dr-amber font-tactical text-[10px] bg-dr-elevated px-1.5 py-0.5 shrink-0">
                      &times;{mission.iterations}
                    </span>
                  )}
                </div>
                <div className="text-dr-dim font-tactical text-[11px] mt-0.5">
                  {mission.assetCodename ?? 'UNASSIGNED'} &middot;{' '}
                  {formatRelativeTime(mission.createdAt)}
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0 ml-4">
                <TacBadge status={mission.status ?? 'standby'} />
                <Link
                  href={`/projects/${battlefieldId}/missions/${mission.id}`}
                  className="text-dr-amber font-tactical text-xs tracking-wider hover:text-dr-green transition-colors"
                >
                  VIEW
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
