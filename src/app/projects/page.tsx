import Link from 'next/link';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { TacCard } from '@/components/ui/tac-card';
import { TacBadge } from '@/components/ui/tac-badge';
import { TacButton } from '@/components/ui/tac-button';
import type { Battlefield } from '@/types';

export default function ProjectsPage() {
  const db = getDatabase();
  const allBattlefields = db.select().from(battlefields).all() as Battlefield[];

  if (allBattlefields.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-dr-amber font-tactical text-sm tracking-wider mb-2">
            NO BATTLEFIELDS DEPLOYED
          </div>
          <div className="text-dr-dim font-tactical text-xs mb-4">
            Create one to begin operations.
          </div>
          <Link href="/projects/new">
            <TacButton size="sm">+ NEW BATTLEFIELD</TacButton>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
          BATTLEFIELDS // SELECT THEATER OF OPERATIONS
        </div>
        <Link href="/projects/new">
          <TacButton size="sm">+ NEW BATTLEFIELD</TacButton>
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {allBattlefields.map((bf) => {
          const statusColor = bf.status === 'active'
            ? 'green'
            : bf.status === 'initializing'
              ? 'blue'
              : undefined;

          return (
            <Link key={bf.id} href={`/projects/${bf.id}`}>
              <TacCard
                status={statusColor as 'green' | 'amber' | 'red' | 'blue' | undefined}
                className="hover:border-dr-amber transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="text-dr-amber font-tactical text-sm tracking-wider uppercase">
                    {bf.codename}
                  </div>
                  <TacBadge status={bf.status ?? 'initializing'} />
                </div>
                <div className="text-dr-text font-tactical text-xs mb-1">
                  {bf.name}
                </div>
                {bf.description && (
                  <div className="text-dr-muted font-tactical text-xs line-clamp-2">
                    {bf.description}
                  </div>
                )}
              </TacCard>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
