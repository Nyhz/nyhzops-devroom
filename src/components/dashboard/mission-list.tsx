'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SearchInput } from '@/components/ui/search-input';
import { TacBadge, getStatusBorderColor } from '@/components/ui/tac-badge';
import { TacCard } from '@/components/ui/tac-card';
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

export function MissionList({ missions, battlefieldId }: MissionListProps) {
  const [search, setSearch] = useState('');

  const filtered = search
    ? missions.filter((m) =>
        (m.title ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : missions;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="text-dr-amber font-tactical text-sm tracking-widest uppercase">
          MISSIONS
        </div>
        <SearchInput
          placeholder="Search missions..."
          className="w-full sm:w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <TacCard className="p-8 text-center">
          <div className="text-dr-dim font-tactical text-xs">
            {missions.length === 0
              ? 'No missions deployed yet. Deploy your first mission above.'
              : 'No missions match your search.'}
          </div>
        </TacCard>
      ) : (
        <div className="space-y-px">
          {filtered.map((mission) => (
            <div
              key={mission.id}
              className={`bg-dr-surface border-l-2 ${getStatusBorderColor(mission.status)} flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between md:px-5 md:py-4 md:gap-0`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span className="text-dr-text font-tactical text-base truncate">
                    {mission.title ?? 'Untitled Mission'}
                  </span>
                  {(mission.iterations ?? 0) > 1 && (
                    <span className="text-dr-amber font-tactical text-xs bg-dr-elevated px-2 py-0.5 shrink-0">
                      &times;{mission.iterations}
                    </span>
                  )}
                </div>
                <div className="text-dr-dim font-tactical text-sm mt-1" suppressHydrationWarning>
                  {mission.assetCodename ?? 'UNASSIGNED'} &middot;{' '}
                  {formatRelativeTime(mission.createdAt)}
                </div>
              </div>
              <div className="flex items-center gap-3 md:gap-5 shrink-0 md:ml-4">
                <TacBadge status={mission.status ?? 'standby'} />
                <Link
                  href={`/battlefields/${battlefieldId}/missions/${mission.id}`}
                  className="text-dr-amber font-tactical text-sm tracking-wider hover:text-dr-green transition-colors"
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
