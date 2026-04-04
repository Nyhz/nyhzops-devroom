import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import type { RepoVitals as RepoVitalsType } from '@/types';

interface RepoVitalsProps {
  vitals: RepoVitalsType;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function RepoVitals({ vitals, className }: RepoVitalsProps) {
  return (
    <TacCard className={cn('p-0', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-dr-border">
        <span className="text-dr-amber text-xs font-tactical tracking-wider">
          REPO VITALS
        </span>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-px bg-dr-border">
        {/* Repo Size */}
        <div className="bg-dr-surface flex-1 min-w-[120px] px-4 py-3">
          <div className="text-dr-dim text-xs font-tactical tracking-wider">REPO SIZE</div>
          <div className="text-dr-text text-sm font-mono font-semibold mt-1">
            {formatBytes(vitals.repoSize)}
          </div>
        </div>

        {/* Total Commits */}
        <div className="bg-dr-surface flex-1 min-w-[120px] px-4 py-3">
          <div className="text-dr-dim text-xs font-tactical tracking-wider">TOTAL COMMITS</div>
          <div className="text-dr-text text-sm font-mono font-semibold mt-1">
            {vitals.totalCommits.toLocaleString()}
          </div>
        </div>

        {/* Last Commit */}
        <div className="bg-dr-surface flex-[2] min-w-[200px] px-4 py-3">
          <div className="text-dr-dim text-xs font-tactical tracking-wider">LAST COMMIT</div>
          {vitals.lastCommit ? (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-dr-muted text-xs font-mono shrink-0">
                {formatTime(vitals.lastCommit.timestamp)}
              </span>
              <span className="text-dr-text text-xs font-mono truncate">
                {vitals.lastCommit.message.slice(0, 60)}
                {vitals.lastCommit.message.length > 60 ? '…' : ''}
              </span>
            </div>
          ) : (
            <div className="text-dr-dim text-xs font-mono mt-1">—</div>
          )}
        </div>

        {/* Worktree Disk */}
        <div className="bg-dr-surface flex-1 min-w-[120px] px-4 py-3">
          <div className="text-dr-dim text-xs font-tactical tracking-wider">WORKTREE DISK</div>
          <div className="text-dr-text text-sm font-mono font-semibold mt-1">
            {formatBytes(vitals.worktreeDisk)}
          </div>
        </div>

        {/* Main Branch */}
        <div className="bg-dr-surface flex-1 min-w-[140px] px-4 py-3">
          <div className="text-dr-dim text-xs font-tactical tracking-wider">MAIN BRANCH</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-dr-text text-sm font-mono">{vitals.mainBranch}</span>
            <span
              className={cn(
                'text-xs font-tactical tracking-wide',
                vitals.isDirty ? 'text-dr-amber' : 'text-dr-green',
              )}
            >
              {vitals.isDirty ? 'DIRTY' : 'CLEAN'}
            </span>
          </div>
        </div>
      </div>
    </TacCard>
  );
}
